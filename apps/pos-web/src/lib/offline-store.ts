'use client';
import type { CreateBillCommand, PosMenuSnapshot } from '@jksh/contracts';
import { kvGet, kvSet, kvDel, outboxAll, outboxDel, outboxPut } from './offline-db';

const KIT_KEY = 'offline_kit';

/**
 * Everything the terminal needs to keep selling with no network: the last
 * server-approved menu, a short-lived offline-auth bundle, and a block of
 * pre-allocated receipt numbers. Refreshed whenever the terminal is online.
 */
export interface OfflineKit {
  outletName: string;
  menu: PosMenuSnapshot;
  authToken: string;
  authExpiresAt: string;
  businessDate: string;
  /** Reserved receipt numbers not yet used, in order. */
  receiptNumbers: string[];
  blockExpiresAt: string;
  savedAt: string;
}

export async function saveOfflineKit(kit: OfflineKit): Promise<void> {
  await kvSet(KIT_KEY, kit);
}

export async function readOfflineKit(): Promise<OfflineKit | null> {
  return (await kvGet<OfflineKit>(KIT_KEY)) ?? null;
}

export async function clearOfflineKit(): Promise<void> {
  await kvDel(KIT_KEY);
}

/** True when the kit can still authorise an offline sale right now. */
export function kitUsable(kit: OfflineKit | null, now = Date.now()): boolean {
  if (!kit) return false;
  return (
    kit.receiptNumbers.length > 0 &&
    Date.parse(kit.authExpiresAt) > now &&
    Date.parse(kit.blockExpiresAt) > now
  );
}

/** Pops the next reserved receipt number and persists the shortened block. */
export async function takeReceiptNumber(): Promise<string | null> {
  const kit = await readOfflineKit();
  if (!kit || kit.receiptNumbers.length === 0) return null;
  const [next, ...rest] = kit.receiptNumbers;
  await saveOfflineKit({ ...kit, receiptNumbers: rest });
  return next ?? null;
}

export type OutboxStatus = 'pending' | 'synced' | 'failed';

export interface OutboxBill {
  key: string; // = cmd.idempotencyKey
  cmd: CreateBillCommand;
  /** What the receipt printed at sale time (server recomputes on sync). */
  provisional: {
    receiptNumber: string | null;
    total: string;
    paymentMethod: 'cash' | 'upi' | null;
    lineCount: number;
  };
  queuedAt: string;
  attempts: number;
  status: OutboxStatus;
  syncedBillId?: string;
  error?: string;
}

export async function enqueueOutboxBill(
  entry: Omit<OutboxBill, 'attempts' | 'status'>,
): Promise<void> {
  await outboxPut({ ...entry, attempts: 0, status: 'pending' });
}

export async function listOutboxBills(): Promise<OutboxBill[]> {
  const all = await outboxAll<OutboxBill>();
  return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function updateOutboxBill(key: string, patch: Partial<OutboxBill>): Promise<void> {
  const all = await outboxAll<OutboxBill>();
  const cur = all.find((b) => b.key === key);
  if (!cur) return;
  await outboxPut({ ...cur, ...patch });
}

export async function removeOutboxBill(key: string): Promise<void> {
  await outboxDel(key);
}
