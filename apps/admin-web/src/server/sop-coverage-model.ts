import { chefDraftSchema, type ChefDraft, type ChefEntry, type ChefItem } from '@jksh/contracts';

/**
 * Pure SOP → Stock coverage model (no I/O) so the rules can be unit-tested.
 *
 * For every workbook menu item it answers, in order: did the chef save an SOP
 * and is it complete, is there a Stock recipe and is it published, and is the
 * Billing menu item linked to it. Ingredient names from saved SOPs are matched
 * to active Stock items by normalised name; anything unmatched is listed with
 * how many SOPs use it, which is the to-do list for creating Stock items.
 */

export type SopState = 'missing' | 'draft' | 'ready';
export type RecipeState = 'none' | 'draft' | 'published';
export type CoverageStage =
  | 'needs_sop'
  | 'sop_in_progress'
  | 'needs_stock_items'
  | 'needs_recipe'
  | 'needs_publish'
  | 'needs_billing_link'
  | 'done';

export interface CoverageRecipe {
  id: string;
  billingMenuItemId: string | null;
  status: string;
  currentVersion: number;
}

export interface CoverageCatalogItem {
  id: string;
  name: string;
  ownerScope: 'master' | 'outlet';
  outletName: string | null;
  stockRecipeId: string | null;
}

export interface CoverageRow {
  itemId: string;
  name: string;
  category: string;
  sop: SopState;
  sopIssue: string | null;
  ingredients: { name: string; matched: boolean }[];
  recipe: RecipeState;
  recipeId: string | null;
  linked: boolean;
  inBilling: boolean;
  stage: CoverageStage;
}

export interface UnmappedIngredient {
  name: string;
  units: string[];
  usedBy: number;
}

export interface CoverageModel {
  rows: CoverageRow[];
  stageCounts: Record<CoverageStage, number>;
  unmapped: UnmappedIngredient[];
  outletItemsWithoutRecipe: CoverageCatalogItem[];
}

/** "Milk (full cream)", " MILK " and "milk" all match the same Stock item. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const STAGE_ORDER: CoverageStage[] = [
  'needs_sop',
  'sop_in_progress',
  'needs_stock_items',
  'needs_recipe',
  'needs_publish',
  'needs_billing_link',
  'done',
];

export function buildCoverage(input: {
  menu: ChefItem[];
  entries: ChefEntry[];
  stockItemNames: string[];
  recipes: CoverageRecipe[];
  catalog: CoverageCatalogItem[];
}): CoverageModel {
  const stockNames = new Set(input.stockItemNames.map(normaliseName).filter(Boolean));
  const entries = new Map(input.entries.map((e) => [e.itemId, e]));
  const catalog = new Map(input.catalog.map((c) => [c.id, c]));
  const recipesByItem = new Map<string, CoverageRecipe>();
  for (const r of input.recipes) {
    if (!r.billingMenuItemId) continue;
    const prev = recipesByItem.get(r.billingMenuItemId);
    // Prefer a published recipe, then the newest version.
    if (
      !prev ||
      (r.status === 'published' && prev.status !== 'published') ||
      (r.status === prev.status && r.currentVersion > prev.currentVersion)
    )
      recipesByItem.set(r.billingMenuItemId, r);
  }

  const unmapped = new Map<string, { name: string; units: Set<string>; items: Set<string> }>();
  const rows = input.menu.map((item): CoverageRow => {
    const entry = entries.get(item.id);
    let sop: SopState = 'missing';
    let sopIssue: string | null = null;
    let draft: ChefDraft | null = null;
    if (entry) {
      draft = entry.draft;
      const ready = draft.status === 'ready' && chefDraftSchema.safeParse(draft).success;
      sop = ready ? 'ready' : 'draft';
      if (!ready) {
        const parsed = chefDraftSchema.safeParse({ ...draft, status: 'ready' });
        sopIssue = parsed.success
          ? 'Not marked ready by the chef'
          : (parsed.error.issues[0]?.message ?? null);
      }
    }
    const ingredients = (draft?.ingredients ?? [])
      .filter((i) => i.name.trim())
      .map((i) => {
        const key = normaliseName(i.name);
        const matched = stockNames.has(key);
        if (!matched && key) {
          const u = unmapped.get(key) ?? {
            name: i.name.trim(),
            units: new Set(),
            items: new Set(),
          };
          u.units.add(i.unit);
          u.items.add(item.id);
          unmapped.set(key, u);
        }
        return { name: i.name.trim(), matched };
      });
    const recipe = recipesByItem.get(item.id) ?? null;
    const recipeState: RecipeState = !recipe
      ? 'none'
      : recipe.status === 'published'
        ? 'published'
        : 'draft';
    const billing = catalog.get(item.id);
    const linked = !!billing?.stockRecipeId && billing.stockRecipeId === recipe?.id;
    const stage: CoverageStage =
      sop === 'missing'
        ? 'needs_sop'
        : sop === 'draft'
          ? 'sop_in_progress'
          : ingredients.some((i) => !i.matched)
            ? 'needs_stock_items'
            : recipeState === 'none'
              ? 'needs_recipe'
              : recipeState === 'draft'
                ? 'needs_publish'
                : !linked
                  ? 'needs_billing_link'
                  : 'done';
    return {
      itemId: item.id,
      name: item.name,
      category: item.category,
      sop,
      sopIssue,
      ingredients,
      recipe: recipeState,
      recipeId: recipe?.id ?? null,
      linked,
      inBilling: !!billing,
      stage,
    };
  });

  const stageCounts = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<
    CoverageStage,
    number
  >;
  for (const r of rows) stageCounts[r.stage] += 1;

  const menuIds = new Set(input.menu.map((m) => m.id));
  return {
    rows,
    stageCounts,
    unmapped: [...unmapped.values()]
      .map((u) => ({ name: u.name, units: [...u.units].sort(), usedBy: u.items.size }))
      .sort((a, b) => b.usedBy - a.usedBy || a.name.localeCompare(b.name)),
    outletItemsWithoutRecipe: input.catalog
      .filter((c) => c.ownerScope === 'outlet' && !c.stockRecipeId && !menuIds.has(c.id))
      .sort(
        (a, b) =>
          (a.outletName ?? '').localeCompare(b.outletName ?? '') || a.name.localeCompare(b.name),
      ),
  };
}
