import { describe, expect, it } from 'vitest';
import { calculateBill } from './bill-calc';

describe('calculateBill - money', () => {
  it('sums lines and add-ons (UPI: exact, zero round adjustment)', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [
        { unitPrice: '15.00', quantity: 2, addons: [{ unitPrice: '5.00', quantity: 1 }] },
        { unitPrice: '25.50', quantity: 1, addons: [] },
      ],
    });
    expect(r.subtotal).toBe('60.50');
    expect(r.discountTotal).toBe('0.00');
    expect(r.preRoundTotal).toBe('60.50');
    expect(r.roundAdjustment).toBe('0.00');
    expect(r.finalTotal).toBe('60.50');
    expect(r.isComplimentary).toBe(false);
  });

  it('rounds a Cash total to the nearest rupee and records the adjustment', () => {
    const down = calculateBill({
      paymentMethod: 'cash',
      lines: [{ unitPrice: '60.49', quantity: 1, addons: [] }],
    });
    expect(down.preRoundTotal).toBe('60.49');
    expect(down.finalTotal).toBe('60.00');
    expect(down.roundAdjustment).toBe('-0.49');

    const up = calculateBill({
      paymentMethod: 'cash',
      lines: [{ unitPrice: '60.50', quantity: 1, addons: [] }],
    });
    expect(up.finalTotal).toBe('61.00');
    expect(up.roundAdjustment).toBe('0.50');
  });

  it('applies a fixed line discount and never goes negative', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [
        {
          unitPrice: '100.00',
          quantity: 1,
          addons: [],
          lineDiscount: { kind: 'fixed', value: '150.00' },
        },
      ],
    });
    expect(r.lines[0]!.discount).toBe('100.00');
    expect(r.lines[0]!.finalTotal).toBe('0.00');
    expect(r.isComplimentary).toBe(true);
  });

  it('applies a percentage line discount (half-up)', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [
        {
          unitPrice: '99.00',
          quantity: 1,
          addons: [],
          lineDiscount: { kind: 'percent', value: '10' },
        },
      ],
    });
    // 9900 * 10% = 990 paise
    expect(r.lines[0]!.discount).toBe('9.90');
    expect(r.lines[0]!.finalTotal).toBe('89.10');
  });

  it('allocates a bill discount across lines with the remainder on the last line', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [
        { unitPrice: '10.00', quantity: 1, addons: [] },
        { unitPrice: '10.00', quantity: 1, addons: [] },
        { unitPrice: '10.00', quantity: 1, addons: [] },
      ],
      billDiscount: { kind: 'fixed', value: '10.00' },
    });
    const discs = r.lines.map((l) => l.discount);
    expect(discs).toEqual(['3.33', '3.33', '3.34']);
    expect(r.discountTotal).toBe('10.00');
    expect(r.finalTotal).toBe('20.00');
  });

  it('caps a bill discount at the payable amount', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [{ unitPrice: '40.00', quantity: 1, addons: [] }],
      billDiscount: { kind: 'percent', value: '200' },
    });
    expect(r.finalTotal).toBe('0.00');
    expect(r.isComplimentary).toBe(true);
  });

  it('a complimentary (zero) bill needs no payment method', () => {
    const r = calculateBill({
      paymentMethod: null,
      lines: [
        {
          unitPrice: '50.00',
          quantity: 1,
          addons: [],
          lineDiscount: { kind: 'percent', value: '100' },
        },
      ],
    });
    expect(r.finalTotal).toBe('0.00');
    expect(r.isComplimentary).toBe(true);
  });

  it('rejects a positive-total bill with no payment method', () => {
    expect(() =>
      calculateBill({
        paymentMethod: null,
        lines: [{ unitPrice: '10.00', quantity: 1, addons: [] }],
      }),
    ).toThrow(/payment method/);
  });

  it('rejects a non-integer or non-positive quantity', () => {
    expect(() =>
      calculateBill({
        paymentMethod: 'upi',
        lines: [{ unitPrice: '10.00', quantity: 0, addons: [] }],
      }),
    ).toThrow(/positive integer/);
  });
});
