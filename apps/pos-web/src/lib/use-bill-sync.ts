'use client';
import { useCallback, useEffect, useState } from 'react';
import { flushBillQueue, queuedBills } from './bill-queue';

export interface BillSyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
}

/**
 * Keeps the bill outbox draining: flushes on reconnect, on a slow poll while
 * anything is pending, and on demand. `onSynced` fires once per bill that
 * reaches the server (billId), so the terminal can surface its receipt.
 */
export function useBillSync(onSynced?: (billId: string) => void): BillSyncState & {
  sync: () => Promise<void>;
} {
  const [state, setState] = useState<BillSyncState>(() => {
    const q = typeof window === 'undefined' ? [] : queuedBills();
    return {
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
      syncing: false,
      pending: q.filter((b) => !b.failed).length,
      failed: q.filter((b) => b.failed).length,
    };
  });

  const sync = useCallback(async () => {
    if (queuedBills().length === 0) return;
    setState((s) => ({ ...s, syncing: true }));
    const r = await flushBillQueue();
    for (const s of r.synced) onSynced?.(s.billId);
    setState((s) => ({ ...s, syncing: false, pending: r.pending, failed: r.failed }));
  }, [onSynced]);

  useEffect(() => {
    const refreshOnline = () => setState((s) => ({ ...s, online: navigator.onLine }));
    const onOnline = () => {
      refreshOnline();
      void sync();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', refreshOnline);

    // Reconcile counts + attempt a flush on mount.
    const q = queuedBills();
    setState((s) => ({
      ...s,
      pending: q.filter((b) => !b.failed).length,
      failed: q.filter((b) => b.failed).length,
    }));
    if (q.length > 0 && navigator.onLine) void sync();

    const id = setInterval(() => {
      if (navigator.onLine && queuedBills().some((b) => !b.failed)) void sync();
    }, 20_000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', refreshOnline);
      clearInterval(id);
    };
  }, [sync]);

  return { ...state, sync };
}
