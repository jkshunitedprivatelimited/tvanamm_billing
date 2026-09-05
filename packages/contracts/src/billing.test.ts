import { describe, expect, it } from 'vitest';
import { createBillCommandSchema, createRefundCommandSchema } from './billing';

describe('billing commands', () => {
  it('accepts an online Cash bill command', () => {
    const result = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY',
      menuVersion: '3',
      paymentMethod: 'cash',
      lines: [{ catalogItemId: '123e4567-e89b-42d3-a456-426614174000', quantity: 2 }],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a complimentary bill (null payment method + 100% line discount)', () => {
    const result = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY2',
      menuVersion: '3',
      paymentMethod: null,
      lines: [
        {
          catalogItemId: '123e4567-e89b-42d3-a456-426614174000',
          quantity: 1,
          lineDiscount: { kind: 'percent', value: '100', reason: 'staff meal' },
        },
      ],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an offline receipt number in the wrong format', () => {
    const result = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY3',
      menuVersion: '3',
      paymentMethod: 'upi',
      lines: [{ catalogItemId: '123e4567-e89b-42d3-a456-426614174000', quantity: 1 }],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
      offline: true,
      terminalReceiptNumber: 'not-a-receipt',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a combo line with no catalogItemId/addons', () => {
    const result = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY4',
      menuVersion: '3',
      paymentMethod: 'cash',
      lines: [{ comboId: '123e4567-e89b-42d3-a456-426614174000', quantity: 1 }],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a line with both catalogItemId and comboId, or neither', () => {
    const both = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY5',
      menuVersion: '3',
      paymentMethod: 'cash',
      lines: [
        {
          catalogItemId: '123e4567-e89b-42d3-a456-426614174000',
          comboId: '123e4567-e89b-42d3-a456-426614174001',
          quantity: 1,
        },
      ],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });
    expect(both.success).toBe(false);
    const neither = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY6',
      menuVersion: '3',
      paymentMethod: 'cash',
      lines: [{ quantity: 1 }],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });
    expect(neither.success).toBe(false);
  });

  it('rejects a combo line with its own add-ons or line discount', () => {
    const withAddons = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY7',
      menuVersion: '3',
      paymentMethod: 'cash',
      lines: [
        {
          comboId: '123e4567-e89b-42d3-a456-426614174000',
          quantity: 1,
          addons: [{ addonId: '123e4567-e89b-42d3-a456-426614174001', quantity: 1 }],
        },
      ],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });
    expect(withAddons.success).toBe(false);
    const withDiscount = createBillCommandSchema.safeParse({
      idempotencyKey: '01JTESTIDEMPOTENCYKEY8',
      menuVersion: '3',
      paymentMethod: 'cash',
      lines: [
        {
          comboId: '123e4567-e89b-42d3-a456-426614174000',
          quantity: 1,
          lineDiscount: { kind: 'fixed', value: '5.00', reason: 'nope' },
        },
      ],
      terminalOccurredAt: '2026-09-03T10:00:00.000Z',
    });
    expect(withDiscount.success).toBe(false);
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
