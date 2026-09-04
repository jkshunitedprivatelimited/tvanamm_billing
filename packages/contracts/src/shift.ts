import { z } from 'zod';
import { moneySchema } from './billing';

/** Optional note-denomination map: { "500": 3, "100": 12, ... } */
export const denominationsSchema = z.record(
  z.string().regex(/^\d{1,4}$/),
  z.int().min(0).max(100000),
);

export const openCashSessionCommandSchema = z.object({
  openingCash: moneySchema,
  denominations: denominationsSchema.optional(),
});
export type OpenCashSessionCommand = z.infer<typeof openCashSessionCommandSchema>;

export const closeCashSessionCommandSchema = z.object({
  countedCash: moneySchema,
  varianceReason: z.string().trim().min(1).max(500).optional(),
  denominations: denominationsSchema.optional(),
});
export type CloseCashSessionCommand = z.infer<typeof closeCashSessionCommandSchema>;

export const startShiftCommandSchema = z.object({
  terminalId: z.uuid().optional(),
});
export type StartShiftCommand = z.infer<typeof startShiftCommandSchema>;

export const forceCloseShiftCommandSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ForceCloseShiftCommand = z.infer<typeof forceCloseShiftCommandSchema>;

export const shiftStatusSchema = z.enum(['open', 'ended', 'force_closed']);
export const cashSessionStatusSchema = z.enum(['open', 'closed', 'force_closed']);

export const shiftSummarySchema = z.object({
  id: z.uuid(),
  outletId: z.uuid(),
  employeeId: z.uuid(),
  employeeName: z.string(),
  status: shiftStatusSchema,
  businessDate: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  billCount: z.int(),
  forceCloseReason: z.string().nullable(),
});
export type ShiftSummary = z.infer<typeof shiftSummarySchema>;

export const cashSessionSummarySchema = z.object({
  id: z.uuid(),
  outletId: z.uuid(),
  status: cashSessionStatusSchema,
  businessDate: z.string(),
  openedByEmployeeId: z.uuid(),
  openedByName: z.string(),
  openedAt: z.string(),
  openingCash: moneySchema,
  closedByEmployeeId: z.uuid().nullable(),
  closedByName: z.string().nullable(),
  closedAt: z.string().nullable(),
  countedCash: moneySchema.nullable(),
  expectedCash: moneySchema.nullable(),
  variance: moneySchema.nullable(),
  varianceReason: z.string().nullable(),
});
export type CashSessionSummary = z.infer<typeof cashSessionSummarySchema>;

export const billingWindowSchema = z.object({
  outletId: z.uuid(),
  businessDate: z.string(),
  blocked: z.boolean(),
  reason: z.enum(['stale_cash_session', 'stale_shift']).nullable(),
});
export type BillingWindow = z.infer<typeof billingWindowSchema>;
