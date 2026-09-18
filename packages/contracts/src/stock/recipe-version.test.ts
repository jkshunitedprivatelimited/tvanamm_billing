import { describe, expect, it } from 'vitest';
import { publishRecipeVersionSchema } from './recipe-version';
const item = '11111111-1111-4111-8111-111111111111';
const base = {
  servingQtyBase: '85',
  servingUnit: 'ml',
  batchYieldBase: '850',
  components: [{ itemId: item, componentType: 'fixed', qtyBase: '3' }],
};
describe('recipe publication measurements', () => {
  it('accepts exact positive base-unit measurements', () => {
    expect(publishRecipeVersionSchema.safeParse(base).success).toBe(true);
  });
  it.each(['0', 'as required', '0.5 g', '5-6', '-1'])(
    'rejects ingredient quantity %s',
    (qtyBase) => {
      expect(
        publishRecipeVersionSchema.safeParse({
          ...base,
          components: [{ ...base.components[0], qtyBase }],
        }).success,
      ).toBe(false);
    },
  );
  it('rejects an unmeasured unit and an oversized serving', () => {
    expect(publishRecipeVersionSchema.safeParse({ ...base, servingUnit: 'cup' }).success).toBe(
      false,
    );
    expect(publishRecipeVersionSchema.safeParse({ ...base, servingQtyBase: '900' }).success).toBe(
      false,
    );
  });
  it('requires exactly one default in an alternative group', () => {
    const a = {
      itemId: item,
      componentType: 'alternative',
      qtyBase: '3',
      alternativeGroup: 'Sweetener',
      isDefault: true,
    };
    expect(publishRecipeVersionSchema.safeParse({ ...base, components: [a, a] }).success).toBe(
      false,
    );
    expect(
      publishRecipeVersionSchema.safeParse({ ...base, components: [a, { ...a, isDefault: false }] })
        .success,
    ).toBe(true);
  });
});
