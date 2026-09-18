import { describe, it, expect } from 'vitest';
import { chefDraftSchema, emptyChefDraft } from './chef-sop-schema';
describe('chef recipe collection validation', () => {
  it('lets a chef save incomplete measured work as a draft', () => {
    expect(chefDraftSchema.safeParse(emptyChefDraft()).success).toBe(true);
  });
  it('does not let an empty recipe be marked ready', () => {
    expect(chefDraftSchema.safeParse({ ...emptyChefDraft(), status: 'ready' }).success).toBe(false);
  });
  it('requires measured amounts rather than ranges or spoons', () => {
    expect(
      chefDraftSchema.safeParse({
        ...emptyChefDraft(),
        ingredients: [{ name: 'Sugar', quantity: '1-2 spoons', unit: 'g', note: '' }],
      }).success,
    ).toBe(false);
  });
  it('requires batch yields and unresolved questions to be completed', () => {
    const d = {
      ...emptyChefDraft(),
      chefName: 'Chef',
      servingQuantity: '110',
      method: 'Mix and serve',
      packaging: '110 ml cup',
      ingredients: [{ name: 'Milk', quantity: '100', unit: 'ml' as const, note: '' }],
      status: 'ready' as const,
    };
    expect(chefDraftSchema.safeParse(d).success).toBe(true);
    expect(chefDraftSchema.safeParse({ ...d, basis: 'batch' }).success).toBe(false);
    expect(chefDraftSchema.safeParse({ ...d, questions: 'Measure spoon' }).success).toBe(false);
  });
});
