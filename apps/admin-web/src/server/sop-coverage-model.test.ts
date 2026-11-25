import { describe, expect, it } from 'vitest';
import { emptyChefDraft, type ChefDraft } from '@jksh/contracts';
import { buildCoverage, normaliseName } from './sop-coverage-model';

const ready = (ingredients: [string, string][]): ChefDraft => ({
  ...emptyChefDraft(),
  chefName: 'Chef',
  servingQuantity: '100',
  method: 'Mix',
  packaging: 'Cup',
  status: 'ready',
  ingredients: ingredients.map(([name, quantity]) => ({ name, quantity, unit: 'ml', note: '' })),
});

const menu = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => ({
  id,
  name: `Item ${id}`,
  category: 'Tea',
}));

describe('SOP coverage', () => {
  it('normalises ingredient names for matching', () => {
    expect(normaliseName(' Milk (full cream) ')).toBe('milk');
    expect(normaliseName('Tea-Powder')).toBe(normaliseName('tea powder'));
  });

  it('places each item at the first unfinished step', () => {
    const model = buildCoverage({
      menu,
      entries: [
        { itemId: 'b', revision: 1, draft: { ...ready([['Milk', '80']]), status: 'draft' } },
        {
          itemId: 'c',
          revision: 1,
          draft: ready([
            ['Milk', '80'],
            ['Saffron', '1'],
          ]),
        },
        { itemId: 'd', revision: 1, draft: ready([['MILK', '80']]) },
        { itemId: 'e', revision: 1, draft: ready([['Milk', '80']]) },
        { itemId: 'f', revision: 1, draft: ready([['Milk', '80']]) },
        { itemId: 'g', revision: 1, draft: ready([['Milk (toned)', '80']]) },
      ],
      stockItemNames: ['Milk'],
      recipes: [
        { id: 'r-e', billingMenuItemId: 'e', status: 'draft', currentVersion: 0 },
        { id: 'r-f', billingMenuItemId: 'f', status: 'published', currentVersion: 1 },
        { id: 'r-g-old', billingMenuItemId: 'g', status: 'draft', currentVersion: 0 },
        { id: 'r-g', billingMenuItemId: 'g', status: 'published', currentVersion: 2 },
      ],
      catalog: [
        { id: 'f', name: 'Item f', ownerScope: 'master', outletName: null, stockRecipeId: null },
        { id: 'g', name: 'Item g', ownerScope: 'master', outletName: null, stockRecipeId: 'r-g' },
        {
          id: 'x',
          name: 'Local juice',
          ownerScope: 'outlet',
          outletName: 'Araku',
          stockRecipeId: null,
        },
        {
          id: 'y',
          name: 'Linked',
          ownerScope: 'outlet',
          outletName: 'Araku',
          stockRecipeId: 'r-f',
        },
      ],
    });
    const stage = Object.fromEntries(model.rows.map((r) => [r.itemId, r.stage]));
    expect(stage).toEqual({
      a: 'needs_sop',
      b: 'sop_in_progress',
      c: 'needs_stock_items',
      d: 'needs_recipe',
      e: 'needs_publish',
      f: 'needs_billing_link',
      g: 'done',
    });
    expect(model.stageCounts.done).toBe(1);
    expect(model.rows.find((r) => r.itemId === 'b')?.sopIssue).toBe('Not marked ready by the chef');
    expect(model.unmapped).toEqual([{ name: 'Saffron', units: ['ml'], usedBy: 1 }]);
    expect(model.outletItemsWithoutRecipe.map((c) => c.name)).toEqual(['Local juice']);
  });

  it('explains why an incomplete SOP is not ready', () => {
    const model = buildCoverage({
      menu: [menu[0]!],
      entries: [{ itemId: 'a', revision: 1, draft: { ...ready([]), status: 'draft' } }],
      stockItemNames: [],
      recipes: [],
      catalog: [],
    });
    expect(model.rows[0]?.sopIssue).toMatch(/Complete the chef name/);
  });
});
