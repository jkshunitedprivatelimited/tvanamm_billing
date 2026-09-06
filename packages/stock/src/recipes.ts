import { createHash } from 'node:crypto';
import { withStockActorContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { recordStockOutbox } from './events';

/**
 * Per-serving ingredient quantity from a measured batch (SOP scaling,
 * `t-vanamm-recipe-standardization.md`): batch ingredient x serving quantity /
 * usable batch yield, in fixed-point base units. Price is never an input.
 */
export function scalePerServing(
  batchIngredientQtyBase: number,
  usableBatchYieldBase: number,
  servingQtyBase: number,
): number {
  if (usableBatchYieldBase <= 0) throw new StockError('validation', 'Batch yield must be positive');
  return (batchIngredientQtyBase * servingQtyBase) / usableBatchYieldBase;
}

export interface ScalingPreview {
  theoreticalServings: number;
  fullServings: number;
  expectedRemainderBase: number;
}

export function scalingPreview(
  usableBatchYieldBase: number,
  servingQtyBase: number,
): ScalingPreview {
  const theoretical = usableBatchYieldBase / servingQtyBase;
  return {
    theoreticalServings: theoretical,
    fullServings: Math.floor(theoretical),
    expectedRemainderBase: usableBatchYieldBase - Math.floor(theoretical) * servingQtyBase,
  };
}

export interface CreateRecipeCommand {
  organizationId: string;
  brandId?: string | null;
  kind: 'menu_item' | 'addon' | 'intermediate';
  billingMenuItemId?: string | null;
  billingAddonId?: string | null;
  outputItemId?: string | null;
  name: string;
}

export async function createRecipe(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateRecipeCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.recipe.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.recipes
         (organization_id, brand_id, kind, billing_menu_item_id, billing_addon_id, output_item_id,
          name, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        cmd.organizationId,
        cmd.brandId ?? null,
        cmd.kind,
        cmd.billingMenuItemId ?? null,
        cmd.billingAddonId ?? null,
        cmd.outputItemId ?? null,
        cmd.name,
        actor.accountId ?? null,
      ],
    );
    return { id: requireRow(ins, 'recipe').id };
  });
}

export interface RecipeComponentInput {
  componentType: 'fixed' | 'optional' | 'alternative' | 'addon' | 'packaging';
  itemId: string;
  qtyBase: string;
  alternativeGroup?: string | null;
  isDefault?: boolean;
  processLossPct?: number;
}

export interface PublishRecipeVersionCommand {
  servingQtyBase: string;
  servingUnit: string;
  batchYieldBase?: string | null;
  preparedBaseItemId?: string | null;
  preparedBaseQtyBase?: string | null;
  yieldUnverified?: boolean;
  components: RecipeComponentInput[];
}

/**
 * Publish a new immutable recipe version. Editing a recipe always creates a new
 * version; historical sale snapshots keep the version they used.
 */
export async function publishRecipeVersion(
  pool: StockPool,
  actor: StockActor,
  recipeId: string,
  cmd: PublishRecipeVersionCommand,
): Promise<{ recipeId: string; version: number }> {
  ensureStockAllowed(actor, 'stock.recipe.manage');
  if (cmd.components.length === 0) {
    throw new StockError('validation', 'A recipe version needs at least one component');
  }
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const recipe = await client.query<{ current_version: number; organization_id: string }>(
      'select current_version, organization_id from stock.recipes where id = $1',
      [recipeId],
    );
    const r = recipe.rows[0];
    if (!r) throw new StockError('not_found', 'Recipe not found');
    const version = r.current_version + 1;

    const checksum = createHash('sha256')
      .update(
        JSON.stringify({
          servingQtyBase: cmd.servingQtyBase,
          servingUnit: cmd.servingUnit,
          batchYieldBase: cmd.batchYieldBase ?? null,
          preparedBaseItemId: cmd.preparedBaseItemId ?? null,
          components: cmd.components
            .map((c) => ({
              t: c.componentType,
              i: c.itemId,
              q: c.qtyBase,
              g: c.alternativeGroup ?? null,
              d: c.isDefault ?? true,
              l: c.processLossPct ?? 0,
            }))
            .sort((a, b) => (a.i < b.i ? -1 : 1)),
        }),
      )
      .digest('hex');

    const vIns = await client.query<{ id: string }>(
      `insert into stock.recipe_versions
         (recipe_id, version, batch_yield_base, serving_qty_base, serving_unit,
          prepared_base_item_id, prepared_base_qty_base, yield_unverified, checksum, published_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        recipeId,
        version,
        cmd.batchYieldBase ?? null,
        cmd.servingQtyBase,
        cmd.servingUnit,
        cmd.preparedBaseItemId ?? null,
        cmd.preparedBaseQtyBase ?? null,
        cmd.yieldUnverified ?? false,
        checksum,
        actor.accountId ?? null,
      ],
    );
    const versionId = requireRow(vIns, 'recipe version').id;
    for (const c of cmd.components) {
      await client.query(
        `insert into stock.recipe_components
           (recipe_version_id, component_type, item_id, qty_base, alternative_group, is_default,
            process_loss_pct)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          versionId,
          c.componentType,
          c.itemId,
          c.qtyBase,
          c.alternativeGroup ?? null,
          c.isDefault ?? true,
          c.processLossPct ?? 0,
        ],
      );
    }
    await client.query(
      `update stock.recipes set current_version = $2, status = 'published' where id = $1`,
      [recipeId, version],
    );
    await recordStockAudit(client, {
      action: 'recipe.published',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: r.organization_id,
      subjectType: 'recipe',
      subjectId: recipeId,
      data: { version, componentCount: cmd.components.length },
    });
    await recordStockOutbox(client, {
      aggregateType: 'recipe',
      aggregateId: recipeId,
      eventType: 'RecipePublished',
      payload: { recipeId, version, checksum },
    });
    return { recipeId, version };
  });
}

export interface PublishedRecipe {
  recipeId: string;
  version: number;
  servingQtyBase: string;
  servingUnit: string;
  preparedBaseItemId: string | null;
  preparedBaseQtyBase: string | null;
  components: {
    componentType: string;
    itemId: string;
    qtyBase: string;
    alternativeGroup: string | null;
    isDefault: boolean;
    processLossPct: string;
  }[];
}

export async function getPublishedRecipe(
  pool: StockPool,
  actor: StockActor,
  recipeId: string,
  version: number,
): Promise<PublishedRecipe> {
  ensureStockAllowed(actor, 'stock.recipe.read');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const v = await client.query<{
      id: string;
      serving_qty_base: string;
      serving_unit: string;
      prepared_base_item_id: string | null;
      prepared_base_qty_base: string | null;
    }>(
      `select id, serving_qty_base, serving_unit, prepared_base_item_id, prepared_base_qty_base
         from stock.recipe_versions where recipe_id = $1 and version = $2`,
      [recipeId, version],
    );
    const row = v.rows[0];
    if (!row) throw new StockError('not_found', 'Recipe version not found');
    const comps = await client.query<{
      component_type: string;
      item_id: string;
      qty_base: string;
      alternative_group: string | null;
      is_default: boolean;
      process_loss_pct: string;
    }>(
      `select component_type, item_id, qty_base, alternative_group, is_default, process_loss_pct
         from stock.recipe_components where recipe_version_id = $1`,
      [row.id],
    );
    return {
      recipeId,
      version,
      servingQtyBase: row.serving_qty_base,
      servingUnit: row.serving_unit,
      preparedBaseItemId: row.prepared_base_item_id,
      preparedBaseQtyBase: row.prepared_base_qty_base,
      components: comps.rows.map((c) => ({
        componentType: c.component_type,
        itemId: c.item_id,
        qtyBase: c.qty_base,
        alternativeGroup: c.alternative_group,
        isDefault: c.is_default,
        processLossPct: c.process_loss_pct,
      })),
    };
  });
}
