'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PosMenuSnapshot } from '@jksh/contracts';
import {
  kitUsable,
  listOutboxBills,
  readOfflineKit,
  removeOutboxBill,
  saveOfflineKit,
  updateOutboxBill,
} from './offline-store';

const BLOCK_SIZE = 40;
const LOW_WATER = 10;
const PRIME_EVERY_MS = 10 * 60_000;

export interface OfflineState {
  online: boolean;
  /** Kit is present and still valid — offline sales are possible. */
  ready: boolean;
  priming: boolean;
  receiptsLeft: number;
  pending: number;
  failed: number;
}

interface SyncResult {
  idempotencyKey: string;
  ok: boolean;
  billId?: string;
  error?: string;
}

async function primeOnce(menu: PosMenuSnapshot, outletName: string): Promise<boolean> {
  try {
    const kit = await readOfflineKit();
    const needBlock = !kit || kit.receiptNumbers.length < LOW_WATER;

    const authRes = await fetch('/api/v1/offline-auth', { method: 'POST' });
    if (!authRes.ok) return false;
    const auth = (await authRes.json()) as { token: string; expiresAt: string };

    let receiptNumbers = kit?.receiptNumbers ?? [];
    let businessDate = kit?.businessDate ?? '';
    let blockExpiresAt = kit?.blockExpiresAt ?? auth.expiresAt;
    if (needBlock) {
      const blockRes = await fetch('/api/v1/receipt-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: BLOCK_SIZE }),
      });
      if (blockRes.ok) {
        const block = (await blockRes.json()) as {
          businessDate: string;
          numbers: string[];
          expiresAt: string;
        };
        // Keep numbers for today only; a new business date replaces the block.
        receiptNumbers =
          businessDate && businessDate !== block.businessDate
            ? block.numbers
            : [...receiptNumbers, ...block.numbers];
        businessDate = block.businessDate;
        blockExpiresAt = block.expiresAt;
      }
    }

    await saveOfflineKit({
      outletName,
      menu,
      authToken: auth.token,
      authExpiresAt: auth.expiresAt,
      businessDate,
      receiptNumbers,
      blockExpiresAt,
      savedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

export function useOffline(
  menu: PosMenuSnapshot,
  outletName: string,
  onSynced?: (billId: string) => void,
): OfflineState & { prime: () => Promise<void>; sync: () => Promise<void> } {
  const [state, setState] = useState<OfflineState>({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    ready: false,
    priming: false,
    receiptsLeft: 0,
    pending: 0,
    failed: 0,
  });
  const busy = useRef(false);

  const refreshCounts = useCallback(async () => {
    const [kit, outbox] = await Promise.all([readOfflineKit(), listOutboxBills()]);
    setState((s) => ({
      ...s,
      ready: kitUsable(kit),
      receiptsLeft: kit?.receiptNumbers.length ?? 0,
      pending: outbox.filter((b) => b.status !== 'synced' && b.status !== 'failed').length,
      failed: outbox.filter((b) => b.status === 'failed').length,
    }));
  }, []);

  const prime = useCallback(async () => {
    if (busy.current || !navigator.onLine) return;
    busy.current = true;
    setState((s) => ({ ...s, priming: true }));
    await primeOnce(menu, outletName);
    busy.current = false;
    setState((s) => ({ ...s, priming: false }));
    await refreshCounts();
  }, [menu, outletName, refreshCounts]);

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const outbox = (await listOutboxBills()).filter((b) => b.status === 'pending');
    if (outbox.length === 0) return;
    try {
      const res = await fetch('/api/v1/bills/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bills: outbox.map((b) => b.cmd) }),
      });
      if (!res.ok) return;
      const { results } = (await res.json()) as { results: SyncResult[] };
      for (const r of results) {
        if (r.ok && r.billId) {
          await removeOutboxBill(r.idempotencyKey);
          onSynced?.(r.billId);
        } else {
          await updateOutboxBill(r.idempotencyKey, {
            status: 'failed',
            error: r.error ?? 'Rejected on sync',
          });
        }
      }
    } catch {
      /* still offline — try again on the next tick */
    }
    await refreshCounts();
  }, [onSynced, refreshCounts]);

  useEffect(() => {
    void refreshCounts();
    void prime();

    const goOnline = () => {
      setState((s) => ({ ...s, online: true }));
      void sync();
      void prime();
    };
    const goOffline = () => setState((s) => ({ ...s, online: false }));
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const primeTimer = setInterval(() => void prime(), PRIME_EVERY_MS);
    const syncTimer = setInterval(() => void sync(), 20_000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(primeTimer);
      clearInterval(syncTimer);
    };
  }, [prime, sync, refreshCounts]);

  return { ...state, prime, sync };
}
