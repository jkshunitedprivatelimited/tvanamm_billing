import { describe, expect, it } from 'vitest';
import { createBillCommandSchema, createRefundCommandSchema } from './billing';

describe('billing commands', () => {
  it('accepts Cash and UPI bill commands with valid receipt numbers', () => {
    const result = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY',
      terminalReceiptNumber: '20260903-T01-000001',
      menuVersion: 'menu-v1',
      paymentMethod: 'cash',
      lines: [{ productId: '123e4567-e89b-42d3-a456-426614174000', quantity: 2 }],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('requires a refund reason', () => {
    const result = createRefundCommandSchema.safeParse({
      idempotencyKey: '01JTESTREFUNDIDEMPOTENCY',
      billId: '123e4567-e89b-42d3-a456-426614174000',
      kind: 'partial',
      payoutMethod: 'upi',
      reason: ' ',
      lines: [{ billLineId: '123e4567-e89b-42d3-a456-426614174001', quantity: 1 }],
    });

    expect(result.success).toBe(false);
  });
});
