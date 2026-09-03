import { z } from 'zod';

export const paymentMethodSchema = z.enum(['cash', 'upi']);
export const refundKindSchema = z.enum(['full', 'partial']);

export const moneySchema = z.string().regex(/^\d+(\.\d{1,2})?$/);

export const billLineInputSchema = z.object({
  productId: z.uuid(),
  quantity: z.int().positive(),
});

export const createBillCommandSchema = z.object({
  idempotencyKey: z.string().min(16).max(200),
  terminalReceiptNumber: z.string().regex(/^\d{8}-T\d{2}-\d{6}$/),
  menuVersion: z.string().min(1),
  paymentMethod: paymentMethodSchema,
  discountReason: z.string().trim().min(1).max(500).optional(),
  lines: z.array(billLineInputSchema).min(1).max(200),
  terminalOccurredAt: z.iso.datetime(),
});

export type CreateBillCommand = z.infer<typeof createBillCommandSchema>;

export const refundLineInputSchema = z.object({
  billLineId: z.uuid(),
  quantity: z.int().positive(),
});

export const createRefundCommandSchema = z.object({
  idempotencyKey: z.string().min(16).max(200),
  billId: z.uuid(),
  kind: refundKindSchema,
  payoutMethod: paymentMethodSchema,
  reason: z.string().trim().min(1).max(500),
  lines: z.array(refundLineInputSchema).min(1).max(200),
});

export type CreateRefundCommand = z.infer<typeof createRefundCommandSchema>;

