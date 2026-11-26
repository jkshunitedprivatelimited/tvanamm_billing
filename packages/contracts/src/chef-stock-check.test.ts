import { describe, expect, it } from 'vitest';
import {
  chefDraftSchema,
  emptyChefDraft,
  suggestChefStockCheck,
  TVANAMM_STOCK_ITEMS,
} from './chef-sop';

describe('chef stock check', () => {
  it('pre-fills TVANAMM items and milk per one serving from a batch SOP', () => {
    const draft = {
      ...emptyChefDraft(),
      basis: 'batch' as const,
      servingsPerBatch: '12',
      ingredients: [
        { name: 'MILK', quantity: '1000', unit: 'ml' as const, note: '' },
        { name: ' TEA POEDR ', quantity: '30', unit: 'g' as const, note: '' },
        { name: 'ELACHI POWDER', quantity: '5', unit: 'g' as const, note: '' },
        { name: 'SUGAR', quantity: '70', unit: 'g' as const, note: '' },
      ],
    };
    const s = suggestChefStockCheck(draft);
    expect(s.lines).toEqual([
      { item: 'Milk', quantity: '83.33', unit: 'ml', confirmed: false },
      { item: 'Tea Powder', quantity: '2.5', unit: 'g', confirmed: false },
      { item: 'Elachi Powder', quantity: '0.42', unit: 'g', confirmed: false },
    ]);
    expect(s.confirmed).toBe(false);
  });

  it('keeps old SOPs valid and accepts a confirmed stock check', () => {
    expect(chefDraftSchema.safeParse(emptyChefDraft()).success).toBe(true);
    const withStock = {
      ...emptyChefDraft(),
      stock: {
        lines: [{ item: 'Tea Powder', quantity: '2.5', unit: 'g', confirmed: true }],
        container: 'Tea Cups',
        confirmed: true,
      },
    };
    expect(chefDraftSchema.safeParse(withStock).success).toBe(true);
    expect(
      chefDraftSchema.safeParse({ ...withStock, stock: { ...withStock.stock, extra: 1 } }).success,
    ).toBe(false);
  });

  it('lists every imported TVANAMM item once, plus milk', () => {
    const names = TVANAMM_STOCK_ITEMS.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Milk');
    expect(names).toHaveLength(72);
  });
});
