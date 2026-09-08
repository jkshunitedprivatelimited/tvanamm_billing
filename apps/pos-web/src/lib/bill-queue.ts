'use client';
import type { CreateBillCommand } from '@jksh/contracts';

/**
 * A localStorage-backed outbox for bills that could not reach the server
 * because the connection dropped mid-checkout. Each bill keeps its
 * client-generated idempotency key, so re-sending it can never create a
 * duplicate. This is the connection-loss safety net, not full offline mode:
 * a queued bill has no receipt number until it syncs.
 */

const KEY = 'jksh_bill_outbox_v1';

export interface QueuedBill {
  key: string;
  cmd: CreateBillCommand;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  failed?: boolean;
}

function read(): QueuedBill[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedBill[]) : [];
  } catch {
    return [];
  }
}

function write(list: QueuedBill[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full / disabled — nothing we can safely do here */
  }
}

export function queuedBills(): QueuedBill[] {
  return read();
}

export function enqueueBill(cmd: CreateBillCommand): QueuedBill {
  const entry: QueuedBill = {
    key: cmd.idempotencyKey,
    cmd,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  const list = read().filter((b) => b.key !== entry.key);
  list.push(entry);
  write(list);
  return entry;
}

export function removeQueuedBill(key: string): void {
  write(read().filter((b) => b.key !== key));
}

export interface FlushResult {
  synced: { key: string; billId: string }[];
  pending: number;
  failed: number;
}

/**
 * Attempt to send every non-failed queued bill, oldest first, one at a time so
 * per-terminal order is preserved. Network errors and 5xx keep the bill for a
 * later retry; a 4xx marks it failed (needs a person to look).
 */
export async function flushBillQueue(): Promise<FlushResult> {
  const list = read();
  const synced: { key: string; billId: string }[] = [];

  for (const bill of list) {
    if (bill.failed) continue;
    try {
      const res = await fetch('/api/v1/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bill.cmd),
      });
      if (res.ok) {
        const body = (await res.json()) as { id?: string };
        if (body.id) {
          synced.push({ key: bill.key, billId: body.id });
          continue;
        }
        bill.attempts += 1;
        bill.lastError = 'Server accepted but returned no bill id';
      } else if (res.status >= 500) {
        bill.attempts += 1;
        bill.lastError = `Server error ${String(res.status)} — will retry`;
      } else {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        bill.attempts += 1;
        bill.failed = true;
        bill.lastError = body.message ?? `Rejected (${String(res.status)})`;
      }
    } catch {
      bill.attempts += 1;
      bill.lastError = 'Still offline';
      break; // no point trying the rest until the network is back
    }
  }

  const remaining = read()
    .map((b) => list.find((x) => x.key === b.key) ?? b)
    .filter((b) => !synced.some((s) => s.key === b.key));
  write(remaining);

  return {
    synced,
    pending: remaining.filter((b) => !b.failed).length,
    failed: remaining.filter((b) => b.failed).length,
  };
}
