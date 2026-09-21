import { describe, expect, it } from 'vitest';
import { createCatalogItemCommandSchema } from '@jksh/contracts';
import { inheritOutletItemTax } from './outlet-item-tax';
import { calculateBill } from './bill-calc';

const input = {
  brandId: '01000000-0000-4000-8000-000000000010',
  outletId: '01000000-0000-4000-8000-000000000011',
  name: 'Outlet item',
  price: '105.00',
};

describe('outlet items with GST-inclusive prices', () => {
  it('accepts an outlet item without a tax profile and preserves its price and outlet', () => {
    expect(createCatalogItemCommandSchema.parse(input)).toMatchObject(input);
    expect(inheritOutletItemTax([{ gst_rate: '5.00', hsn_code: null }])).toEqual({
      gstRate: '5.00',
      hsnCode: null,
    });
    expect(
      calculateBill({
        paymentMethod: 'upi',
        lines: [{ unitPrice: input.price, quantity: 1, addons: [] }],
      }).finalTotal,
    ).toBe('105.00');
  });
  it('rejects owner-supplied tax rates and codes', () => {
    expect(createCatalogItemCommandSchema.safeParse({ ...input, gstRate: '0' }).success).toBe(
      false,
    );
    expect(createCatalogItemCommandSchema.safeParse({ ...input, hsnCode: '1234' }).success).toBe(
      false,
    );
  });
  it('preserves the explicit approved-profile flow', () => {
    expect(
      createCatalogItemCommandSchema.safeParse({ ...input, taxProfileId: input.brandId }).success,
    ).toBe(true);
  });
  it('does not guess a rate when Central settings are missing or mixed', () => {
    expect(() => inheritOutletItemTax([])).toThrow(/Central/);
    expect(() =>
      inheritOutletItemTax([
        { gst_rate: '5', hsn_code: null },
        { gst_rate: '12', hsn_code: null },
      ]),
    ).toThrow(/Central/);
  });
  it('still requires a rate for a master item', () => {
    expect(
      createCatalogItemCommandSchema.safeParse({ ...input, outletId: undefined }).success,
    ).toBe(false);
    expect(
      createCatalogItemCommandSchema.safeParse({ ...input, outletId: undefined, gstRate: '5' })
        .success,
    ).toBe(true);
  });
});
