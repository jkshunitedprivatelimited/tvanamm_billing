import { z } from 'zod';
import { moneySchema } from './billing';

export const expensePaymentSourceSchema = z.enum([
  'shared_cash_drawer',
  'outlet_upi',
  'owner_paid',
  'employee_paid',
]);
export type ExpensePaymentSource = z.infer<typeof expensePaymentSourceSchema>;

export const recordExpenseCommandSchema = z.object({
  idempotencyKey: z.string().min(16).max(200),
  outletId: z.uuid(),
  categoryId: z.uuid().optional(),
  categoryName: z.string().trim().min(1).max(120),
  amount: moneySchema.refine((v) => Number(v) > 0, 'amount must be positive'),
  paymentSource: expensePaymentSourceSchema,
  reason: z.string().trim().min(1).max(500),
  receiptUrl: z.url().max(2000).optional(),
});
export type RecordExpenseCommand = z.infer<typeof recordExpenseCommandSchema>;

export const reviewExpenseCommandSchema = z.object({
  action: z.enum(['approve', 'reverse']),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ReviewExpenseCommand = z.infer<typeof reviewExpenseCommandSchema>;

export const createExpenseCategoryCommandSchema = z.object({
  brandId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120),
});
export type CreateExpenseCategoryCommand = z.infer<typeof createExpenseCategoryCommandSchema>;

export const setExpenseThresholdCommandSchema = z.object({
  /** Central sets the org default; a Franchise Owner sets a per-outlet override. */
  outletId: z.uuid().optional(),
  threshold: moneySchema,
});
export type SetExpenseThresholdCommand = z.infer<typeof setExpenseThresholdCommandSchema>;

export const expenseViewSchema = z.object({
  id: z.uuid(),
  outletId: z.uuid(),
  categoryName: z.string(),
  amount: moneySchema,
  paymentSource: expensePaymentSourceSchema,
  reason: z.string(),
  receiptUrl: z.string().nullable(),
  recordedByName: z.string().nullable(),
  businessDate: z.string(),
  affectsDrawer: z.boolean(),
  isHighValue: z.boolean(),
  reviewedAt: z.string().nullable(),
  reversedAt: z.string().nullable(),
  reversalReason: z.string().nullable(),
  createdAt: z.string(),
});
export type ExpenseView = z.infer<typeof expenseViewSchema>;

export const expenseReportSchema = z.object({
  from: z.string(),
  to: z.string(),
  total: moneySchema,
  drawerTotal: moneySchema,
  byCategory: z.array(z.object({ categoryName: z.string(), total: moneySchema })),
  byPaymentSource: z.array(
    z.object({ paymentSource: expensePaymentSourceSchema, total: moneySchema }),
  ),
  unreviewedCount: z.int(),
});
export type ExpenseReport = z.infer<typeof expenseReportSchema>;
