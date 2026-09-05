import { z } from 'zod';
import { createBillCommandSchema } from './billing';

/** Issued while online; empty body (the operator session already carries
 *  outlet/terminal/employee). */
export const issueOfflineAuthCommandSchema = z.object({});
export type IssueOfflineAuthCommand = z.infer<typeof issueOfflineAuthCommandSchema>;

export const offlineAuthResponseSchema = z.object({
  token: z.string().min(1),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type OfflineAuthResponse = z.infer<typeof offlineAuthResponseSchema>;

export const reserveReceiptBlockCommandSchema = z.object({
  count: z.int().min(1).max(500),
});
export type ReserveReceiptBlockCommand = z.infer<typeof reserveReceiptBlockCommandSchema>;

export const receiptBlockResponseSchema = z.object({
  businessDate: z.string(),
  numbers: z.array(z.string()),
  expiresAt: z.iso.datetime(),
});
export type ReceiptBlockResponse = z.infer<typeof receiptBlockResponseSchema>;

/** A batch of offline-committed bills submitted once the terminal reconnects.
 *  Each carries its own idempotency key, so a retried batch never duplicates
 *  a bill; the response reports each item individually and never silently
 *  drops one. */
export const syncBillsCommandSchema = z.object({
  bills: z.array(createBillCommandSchema).min(1).max(100),
});
export type SyncBillsCommand = z.infer<typeof syncBillsCommandSchema>;

export const syncBillResultSchema = z.object({
  idempotencyKey: z.string(),
  ok: z.boolean(),
  billId: z.uuid().optional(),
  receiptNumber: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
});
export type SyncBillResult = z.infer<typeof syncBillResultSchema>;

export const syncBillsResponseSchema = z.object({
  results: z.array(syncBillResultSchema),
});
export type SyncBillsResponse = z.infer<typeof syncBillsResponseSchema>;
