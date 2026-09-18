import { describe, expect, it } from 'vitest';
import { calculateBill, allocateProportionally, toPaise, fromPaise } from './bill-calc';

describe('calculateBill - money', () => {
  it('sums lines and add-ons (UPI: exact, zero round adjustment)', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [
        { unitPrice: '15.00', quantity: 2, addons: [{ unitPrice: '5.00', quantity: 1 }] },
        { unitPrice: '25.50', quantity: 1, addons: [] },
      ],
    });
    // An add-on's quantity is per unit of the item, same as the POS's own
    // display total: 2 teas x (₹15 + 1 ginger @ ₹5) = ₹40, plus ₹25.50.
    expect(r.subtotal).toBe('65.50');
    expect(r.discountTotal).toBe('0.00');
    expect(r.preRoundTotal).toBe('65.50');
    expect(r.roundAdjustment).toBe('0.00');
    expect(r.finalTotal).toBe('65.50');
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

  it('an autoLineDiscountPaise (offer) applies before the manual line discount', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [
        {
          unitPrice: '100.00',
          quantity: 1,
          addons: [],
          autoLineDiscountPaise: 3000, // 30.00 offer
          lineDiscount: { kind: 'percent', value: '10' }, // 10% of the post-offer 70.00
        },
      ],
    });
    expect(r.lines[0]!.autoDiscount).toBe('30.00');
    expect(r.lines[0]!.discount).toBe('37.00');
    expect(r.lines[0]!.finalTotal).toBe('63.00');
  });

  it('a baseTotalOverride line skips the unitPrice*quantity computation', () => {
    const r = calculateBill({
      paymentMethod: 'upi',
      lines: [{ unitPrice: '999.00', quantity: 3, addons: [], baseTotalOverride: '60.00' }],
    });
    expect(r.subtotal).toBe('60.00');
    expect(r.finalTotal).toBe('60.00');
  });
});

describe('allocateProportionally - combo price allocation', () => {
  it('splits a total exactly by weight, remainder to the last positive weight', () => {
    // 100 paise split 1:2 -> 33/67, not 33/66 + a lost paisa.
    const shares = allocateProportionally(100, [1, 2]);
    expect(shares).toEqual([33, 67]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(100);
  });

  it('skips zero-weight entries entirely', () => {
    const shares = allocateProportionally(300, [0, 100, 200]);
    expect(shares[0]).toBe(0);
    expect((shares[1] ?? 0) + (shares[2] ?? 0)).toBe(300);
  });

  it('returns all zeros when the total or every weight is zero', () => {
    expect(allocateProportionally(0, [10, 20])).toEqual([0, 0]);
    expect(allocateProportionally(500, [0, 0])).toEqual([0, 0]);
  });

  it('always sums to exactly the input total regardless of rounding', () => {
    const shares = allocateProportionally(toPaise('99.99'), [toPaise('33.33'), toPaise('66.66')]);
    expect(fromPaise(shares.reduce((s, x) => s + x, 0))).toBe('99.99');
  });
});
