'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { kvGet, kvSet } from './offline-db';

/**
 * Device queue for stock actions that could not reach the server
 * (purchases, wastage, prepared bases, discards).
 *
 * Every queued request carries the client id the server already uses for
 * idempotency (`id` / `submissionId`), so resending after a lost response can
 * never record it twice. Requests are tagged with the employee who made them
 * and are only sent while that employee is signed in: the server ties each
 * entry to its employee, and sending it under someone else would misattribute
 * it. Rejected requests (the server answered "no") are kept, with the reason,
 * until the employee dismisses them — they are never silently dropped.
 */

const KEY = 'stock_action_queue';

export interface QueuedStockAction {
  key: string;
  employeeId: string;
  path: string;
  body: Record<string, unknown>;
  label: string;
  queuedAt: string;
  attempts: number;
  rejected?: string;
}

async function readQueue(): Promise<QueuedStockAction[]> {
  return (await kvGet<QueuedStockAction[]>(KEY)) ?? [];
}

// One writer at a time within the tab so concurrent enqueue/flush calls do not
// overwrite each other's read-modify-write.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function update(
  fn: (q: QueuedStockAction[]) => QueuedStockAction[],
): Promise<QueuedStockAction[]> {
  return locked(async () => {
    const next = fn(await readQueue());
    await kvSet(KEY, next);
    return next;
  });
}

/** A network failure (no response at all) as opposed to a server answer. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine);
}

export function enqueueStockAction(
  action: Omit<QueuedStockAction, 'queuedAt' | 'attempts'>,
): Promise<QueuedStockAction[]> {
  return update((q) =>
    q.some((a) => a.key === action.key)
      ? q
      : [...q, { ...action, queuedAt: new Date().toISOString(), attempts: 0 }],
  );
}

export function dismissStockAction(key: string): Promise<QueuedStockAction[]> {
  return update((q) => q.filter((a) => a.key !== key));
}

export interface StockFlushResult {
  sent: number;
  rejected: number;
  remaining: number;
}

/**
 * Send this employee's pending actions in the order they were made. Stops at
 * the first network failure (still offline); a 4xx answer marks that action
 * rejected and moves on; a 5xx leaves it pending for the next attempt.
 */
export async function flushStockQueue(
  employeeId: string,
  send: (a: QueuedStockAction) => Promise<Response> = (a) =>
    fetch(a.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a.body),
    }),
): Promise<StockFlushResult> {
  return locked(async () => {
    const queue = await readQueue();
    const result = { sent: 0, rejected: 0, remaining: 0 };
    const keep: QueuedStockAction[] = [];
    let offline = false;
    for (const action of queue) {
      if (offline || action.rejected || action.employeeId !== employeeId) {
        keep.push(action);
        continue;
      }
      try {
        const res = await send(action);
        if (res.ok) {
          result.sent += 1;
          continue;
        }
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408) {
          keep.push({
            ...action,
            attempts: action.attempts + 1,
            rejected: body.message ?? 'Not accepted',
          });
          result.rejected += 1;
        } else {
          keep.push({ ...action, attempts: action.attempts + 1 });
          // Signed out or server trouble: try again later, keep order.
          offline = true;
        }
      } catch {
        keep.push({ ...action, attempts: action.attempts + 1 });
        offline = true;
      }
    }
    await kvSet(KEY, keep);
    result.remaining = keep.filter((a) => !a.rejected && a.employeeId === employeeId).length;
    return result;
  });
}

/**
 * Queue state for one employee, flushed on mount, when the connection returns,
 * and every 30 seconds while anything is pending.
 */
export function useStockQueue(employeeId: string, onSent?: () => void) {
  const [queue, setQueue] = useState<QueuedStockAction[]>([]);
  const [syncing, setSyncing] = useState(false);
  const sentRef = useRef(onSent);
  sentRef.current = onSent;

  const refresh = useCallback(async () => setQueue(await readQueue()), []);

  const flush = useCallback(async () => {
    if (!employeeId) return;
    setSyncing(true);
    try {
      const r = await flushStockQueue(employeeId);
      if (r.sent) sentRef.current?.();
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [employeeId, refresh]);

  const mine = queue.filter((a) => a.employeeId === employeeId);
  const pending = mine.filter((a) => !a.rejected).length;

  useEffect(() => {
    void flush();
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flush]);

  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => void flush(), 30_000);
    return () => window.clearInterval(t);
  }, [pending, flush]);

  return {
    mine,
    pending,
    others: queue.filter((a) => a.employeeId !== employeeId && !a.rejected).length,
    syncing,
    flush,
    enqueue: async (a: Omit<QueuedStockAction, 'queuedAt' | 'attempts' | 'employeeId'>) => {
      setQueue(await enqueueStockAction({ ...a, employeeId }));
    },
    dismiss: async (key: string) => setQueue(await dismissStockAction(key)),
  };
}
