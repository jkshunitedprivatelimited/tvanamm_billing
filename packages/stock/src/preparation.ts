import { z } from 'zod';
import {
  withStockActorContext,
  stockSystemContext,
  type StockPool,
  type StockPoolClient,
} from '@jksh/db';
import { assertOutletInFranchise, ensureStockAllowed, type StockActor } from './authorize';
import { StockError } from './errors';
import { postMovement, pickFefo } from './ledger';
import { recordStockAudit } from './audit';

/**
 * Prepared-base posting (stock migration 0026).
 *
 * An outlet records that it made `outputQtyBase` of an intermediate recipe's
 * output item (e.g. 2000 ml of tea decoction). Component quantities are stored
 * per serving (as the recipe editor and sale consumption use them), so they are
 * scaled by outputQty / serving_qty_base and issued once from the outlet's
 * sellable location; the prepared item is received and a prepared batch opens.
 * Sales whose recipe names that prepared base then draw from the batch instead
 * of the raw components (consumption.ts), so raw stock is never spent twice.
 */

const qty = z.string().regex(/^\d{1,8}(\.\d{1,6})?$/, 'Enter a quantity such as 1000 or 2.5');

export const recordPreparedBatchSchema = z.object({
  submissionId: z.uuid(),
  outletId: z.uuid(),
  recipeId: z.uuid(),
  outputQtyBase: qty.refine((v) => Number(v) > 0, 'Enter a quantity greater than zero'),
});
export type RecordPreparedBatchCommand = z.infer<typeof recordPreparedBatchSchema>;

export const discardPreparedBatchSchema = z.object({
  submissionId: z.uuid(),
  outletId: z.uuid(),
  preparedBatchId: z.uuid(),
  /** Omit to discard everything that is left. */
  qtyBase: qty.refine((v) => Number(v) > 0, 'Enter a quantity greater than zero').optional(),
  reason: z.string().trim().min(1, 'Enter why the base was discarded').max(500),
});
export type DiscardPreparedBatchCommand = z.infer<typeof discardPreparedBatchSchema>;

export interface PreparedBatchInput {
  itemId: string;
  itemName: string;
  qtyBase: string;
  shortfallBase: string;
  /** No physical starting count yet: nothing was issued for this item. */
  skippedUntracked: boolean;
}

export interface PreparedBatchResult {
  id: string;
  duplicate: boolean;
  recipeId: string;
  recipeVersion: number;
  itemId: string;
  outputQtyBase: string;
  inputs: PreparedBatchInput[];
}

export interface PreparationRecipe {
  recipeId: string;
  name: string;
  version: number;
  outputItemId: string;
  outputItemName: string;
  baseUnit: string;
  /** Component quantities are per this much of the prepared item. */
  servingQtyBase: string;
  components: { itemId: string; itemName: string; qtyBase: string; componentType: string }[];
}

export interface PreparedBatchView {
  id: string;
  recipeId: string | null;
  recipeName: string | null;
  itemId: string;
  itemName: string;
  baseUnit: string;
  qtyBaseInitial: string;
  qtyBaseRemaining: string;
  discardedQtyBase: string;
  recordedAt: string;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new StockError('validation', r.error.issues[0]?.message ?? 'Invalid entry');
  return r.data;
}

async function outletLocation(client: StockPoolClient, organizationId: string, outletId: string) {
  const loc = await client.query<{ id: string; franchise_id: string | null }>(
    `select id, franchise_id from stock.stock_locations
      where outlet_id = $1 and organization_id = $2 and scope = 'outlet' and kind = 'sellable'`,
    [outletId, organizationId],
  );
  const row = loc.rows[0];
  if (!row) throw new StockError('conflict', 'Outlet stock tracking is not configured');
  return row;
}

/** Published intermediate recipes an outlet can prepare, with their latest version. */
export async function listPreparationRecipes(
  pool: StockPool,
  actor: StockActor,
): Promise<PreparationRecipe[]> {
  ensureStockAllowed(actor, 'stock.preparation.record');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{
      recipe_id: string;
      name: string;
      version: number;
      version_id: string;
      output_item_id: string;
      output_item_name: string;
      base_unit: string;
      serving_qty_base: string;
    }>(
      `select r.id recipe_id, r.name, rv.version, rv.id version_id, r.output_item_id,
              i.name output_item_name, i.base_unit::text base_unit, rv.serving_qty_base::text
         from stock.recipes r
         join stock.recipe_versions rv on rv.recipe_id = r.id and rv.version = r.current_version
         join stock.items i on i.id = r.output_item_id
        where r.organization_id = $1 and r.kind = 'intermediate' and r.status = 'published'
          and r.output_item_id is not null
        order by r.name`,
      [actor.organizationId],
    );
    if (!rows.length) return [];
    const comps = await client.query<{
      recipe_version_id: string;
      item_id: string;
      item_name: string;
      qty_base: string;
      component_type: string;
    }>(
      `select c.recipe_version_id, c.item_id, i.name item_name, c.qty_base::text,
              c.component_type::text
         from stock.recipe_components c join stock.items i on i.id = c.item_id
        where c.recipe_version_id = any($1::uuid[])
        order by i.name`,
      [rows.map((r) => r.version_id)],
    );
    return rows.map((r) => ({
      recipeId: r.recipe_id,
      name: r.name,
      version: r.version,
      outputItemId: r.output_item_id,
      outputItemName: r.output_item_name,
      baseUnit: r.base_unit,
      servingQtyBase: r.serving_qty_base,
      components: comps.rows
        .filter((c) => c.recipe_version_id === r.version_id)
        .map((c) => ({
          itemId: c.item_id,
          itemName: c.item_name,
          qtyBase: c.qty_base,
          componentType: c.component_type,
        })),
    }));
  });
}

/** Recent prepared batches at one outlet (open ones first). */
export async function listPreparedBatches(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<PreparedBatchView[]> {
  ensureStockAllowed(actor, 'stock.preparation.record');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{
      id: string;
      recipe_id: string | null;
      recipe_name: string | null;
      item_id: string;
      item_name: string;
      base_unit: string;
      qty_base_initial: string;
      qty_base_remaining: string;
      discarded_qty_base: string;
      recorded_at: Date;
    }>(
      `select p.id, p.recipe_id, r.name recipe_name, p.item_id, i.name item_name,
              i.base_unit::text base_unit, p.qty_base_initial::text, p.qty_base_remaining::text,
              p.discarded_qty_base::text, p.recorded_at
         from stock.prepared_batches p
         join stock.items i on i.id = p.item_id
         left join stock.recipes r on r.id = p.recipe_id
        where p.organization_id = $1 and p.outlet_id = $2
        order by (p.qty_base_remaining > 0) desc, p.recorded_at desc
        limit 50`,
      [actor.organizationId, outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      recipeId: r.recipe_id,
      recipeName: r.recipe_name,
      itemId: r.item_id,
      itemName: r.item_name,
      baseUnit: r.base_unit,
      qtyBaseInitial: r.qty_base_initial,
      qtyBaseRemaining: r.qty_base_remaining,
      discardedQtyBase: r.discarded_qty_base,
      recordedAt: r.recorded_at.toISOString(),
    }));
  });
}

async function existingBatch(
  client: StockPoolClient,
  organizationId: string,
  submissionId: string,
): Promise<PreparedBatchResult | null> {
  const p = await client.query<{
    id: string;
    recipe_id: string;
    recipe_version: number;
    item_id: string;
    qty_base_initial: string;
  }>(
    `select id, recipe_id, recipe_version, item_id, qty_base_initial::text
       from stock.prepared_batches where organization_id = $1 and submission_id = $2`,
    [organizationId, submissionId],
  );
  const row = p.rows[0];
  if (!row) return null;
  const inputs = await client.query<{
    item_id: string;
    item_name: string;
    qty_base: string;
    shortfall_base: string;
    skipped_untracked: boolean;
  }>(
    `select pi.item_id, i.name item_name, pi.qty_base::text, pi.shortfall_base::text,
            pi.skipped_untracked
       from stock.prepared_batch_inputs pi join stock.items i on i.id = pi.item_id
      where pi.prepared_batch_id = $1 order by i.name`,
    [row.id],
  );
  return {
    id: row.id,
    duplicate: true,
    recipeId: row.recipe_id,
    recipeVersion: row.recipe_version,
    itemId: row.item_id,
    outputQtyBase: Number(row.qty_base_initial).toFixed(6),
    inputs: inputs.rows.map((i) => ({
      itemId: i.item_id,
      itemName: i.item_name,
      qtyBase: i.qty_base,
      shortfallBase: i.shortfall_base,
      skippedUntracked: i.skipped_untracked,
    })),
  };
}

/**
 * Record a prepared base made at an outlet. Idempotent on `submissionId`: a
 * retry after a lost response returns the original batch and issues nothing.
 * Inputs follow sale consumption's rules: FEFO from usable stock, a shortfall
 * still posts (stock goes negative) and is reported, and an item with no
 * physical starting count is not issued.
 */
export async function recordPreparedBatch(
  pool: StockPool,
  actor: StockActor,
  input: unknown,
): Promise<PreparedBatchResult> {
  ensureStockAllowed(actor, 'stock.preparation.record');
  const cmd = parse(recordPreparedBatchSchema, input);
  await assertOutletInFranchise(pool, actor, cmd.outletId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `prepared-batch:${actor.organizationId}:${cmd.submissionId}`,
    ]);
    const prior = await existingBatch(client, actor.organizationId, cmd.submissionId);
    if (prior) {
      if (
        prior.recipeId !== cmd.recipeId ||
        Number(prior.outputQtyBase) !== Number(cmd.outputQtyBase)
      )
        throw new StockError('conflict', 'This entry was already saved with different details');
      return prior;
    }

    const location = await outletLocation(client, actor.organizationId, cmd.outletId);
    const rv = await client.query<{
      version_id: string;
      version: number;
      output_item_id: string | null;
      serving_qty_base: string;
    }>(
      `select rv.id version_id, rv.version, r.output_item_id, rv.serving_qty_base::text
         from stock.recipes r
         join stock.recipe_versions rv on rv.recipe_id = r.id and rv.version = r.current_version
        where r.id = $1 and r.organization_id = $2 and r.kind = 'intermediate'
          and r.status = 'published'`,
      [cmd.recipeId, actor.organizationId],
    );
    const version = rv.rows[0];
    if (!version) throw new StockError('not_found', 'Preparation recipe is not published');
    if (!version.output_item_id)
      throw new StockError('conflict', 'Preparation recipe has no prepared item set');
    const output = Number(cmd.outputQtyBase);
    const factor = output / Number(version.serving_qty_base);
    const batch = await client.query<{ id: string }>(
      `insert into stock.prepared_batches
         (organization_id, stock_location_id, outlet_id, item_id, qty_base_initial,
          qty_base_remaining, recorded_by, recorded_by_employee, recipe_id, recipe_version,
          submission_id)
       values ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10) returning id`,
      [
        actor.organizationId,
        location.id,
        cmd.outletId,
        version.output_item_id,
        output.toFixed(6),
        actor.accountId ?? null,
        actor.employeeId ?? null,
        cmd.recipeId,
        version.version,
        cmd.submissionId,
      ],
    );
    const batchId = batch.rows[0]?.id;
    if (!batchId) throw new StockError('conflict', 'Could not record the prepared batch');
    const key = `prepared:${batchId}`;
    const actorFields = {
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
      actorEmployeeId: actor.employeeId ?? null,
    };

    const comps = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      component_type: string;
      qty_base: string;
      is_default: boolean;
      process_loss_pct: string;
    }>(
      `select c.id, c.item_id, i.name item_name, c.component_type::text, c.qty_base::text,
              c.is_default, c.process_loss_pct::text
         from stock.recipe_components c join stock.items i on i.id = c.item_id
        where c.recipe_version_id = $1 order by i.name`,
      [version.version_id],
    );
    const inputs: PreparedBatchInput[] = [];
    for (const c of comps.rows) {
      const used =
        c.component_type === 'fixed' ||
        c.component_type === 'packaging' ||
        ((c.component_type === 'alternative' || c.component_type === 'optional') && c.is_default);
      if (!used) continue;
      const required = Number(
        (Number(c.qty_base) * factor * (1 + Number(c.process_loss_pct) / 100)).toFixed(6),
      );
      if (!(required > 0)) continue;
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `stock-start:${location.id}:${c.item_id}`,
      ]);
      const started = await client.query(
        `select 1 from stock.item_tracking_starts
          where stock_location_id = $1 and item_id = $2 and started_at <= now()`,
        [location.id, c.item_id],
      );
      let shortfall = 0;
      const skipped = !started.rowCount;
      if (!skipped) {
        const picked = await pickFefo(client, location.id, c.item_id, required.toFixed(6));
        for (const pick of picked.picks) {
          await postMovement(client, {
            organizationId: actor.organizationId,
            stockLocationId: location.id,
            itemId: c.item_id,
            batchId: pick.batchId,
            quantity: (-Number(pick.quantity)).toFixed(6),
            movementType: 'production_input',
            sourceDocType: 'prepared_batch',
            sourceDocId: batchId,
            idempotencyKey: `${key}:in:${c.id}:${pick.batchId ?? 'nb'}`,
            notes: 'prepared base input',
            ...actorFields,
          });
        }
        shortfall = Number(picked.shortfall);
        if (shortfall > 0) {
          await postMovement(client, {
            organizationId: actor.organizationId,
            stockLocationId: location.id,
            itemId: c.item_id,
            batchId: null,
            quantity: (-shortfall).toFixed(6),
            movementType: 'production_input',
            sourceDocType: 'prepared_batch',
            sourceDocId: batchId,
            idempotencyKey: `${key}:in:${c.id}:shortfall`,
            notes: 'prepared base input — negative-stock shortfall',
            ...actorFields,
          });
          await client.query(
            `insert into stock.negative_stock_exceptions
               (organization_id, outlet_id, stock_location_id, item_id, qty_base, business_date)
             values ($1,$2,$3,$4,$5,current_date)`,
            [actor.organizationId, cmd.outletId, location.id, c.item_id, shortfall.toFixed(6)],
          );
        }
      }
      await client.query(
        `insert into stock.prepared_batch_inputs
           (prepared_batch_id, item_id, qty_base, shortfall_base, skipped_untracked)
         values ($1,$2,$3,$4,$5)`,
        [batchId, c.item_id, required.toFixed(6), shortfall.toFixed(6), skipped],
      );
      inputs.push({
        itemId: c.item_id,
        itemName: c.item_name,
        qtyBase: required.toFixed(6),
        shortfallBase: shortfall.toFixed(6),
        skippedUntracked: skipped,
      });
    }

    await postMovement(client, {
      organizationId: actor.organizationId,
      stockLocationId: location.id,
      itemId: version.output_item_id,
      quantity: output.toFixed(6),
      movementType: 'production_output',
      sourceDocType: 'prepared_batch',
      sourceDocId: batchId,
      idempotencyKey: `${key}:out`,
      notes: 'prepared base made',
      ...actorFields,
    });
    await recordStockAudit(client, {
      action: 'prepared_batch.recorded',
      actorRequest: actor.request,
      accountId: actor.accountId,
      employeeId: actor.employeeId,
      organizationId: actor.organizationId,
      franchiseId: location.franchise_id,
      outletId: cmd.outletId,
      subjectType: 'prepared_batch',
      subjectId: batchId,
      data: {
        recipeId: cmd.recipeId,
        recipeVersion: version.version,
        outputQtyBase: output.toFixed(6),
      },
    });
    return {
      id: batchId,
      duplicate: false,
      recipeId: cmd.recipeId,
      recipeVersion: version.version,
      itemId: version.output_item_id,
      outputQtyBase: output.toFixed(6),
      inputs,
    };
  });
}

/**
 * Discard leftover prepared base (end of day, spoiled). Reduces what later
 * sales can draw from and posts wastage on the prepared item. Raw inputs are
 * not restored. Idempotent on `submissionId`.
 */
export async function discardPreparedBatch(
  pool: StockPool,
  actor: StockActor,
  input: unknown,
): Promise<{ id: string; duplicate: boolean; qtyBase: string; remainingBase: string }> {
  ensureStockAllowed(actor, 'stock.preparation.record');
  const cmd = parse(discardPreparedBatchSchema, input);
  await assertOutletInFranchise(pool, actor, cmd.outletId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `prepared-discard:${actor.organizationId}:${cmd.submissionId}`,
    ]);
    const prior = await client.query<{ id: string; prepared_batch_id: string; qty_base: string }>(
      `select id, prepared_batch_id, qty_base::text from stock.prepared_batch_discards
        where organization_id = $1 and submission_id = $2`,
      [actor.organizationId, cmd.submissionId],
    );
    const before = prior.rows[0];
    if (before) {
      if (before.prepared_batch_id !== cmd.preparedBatchId)
        throw new StockError('conflict', 'This entry was already saved with different details');
      const rem = await client.query<{ qty_base_remaining: string }>(
        'select qty_base_remaining::text from stock.prepared_batches where id = $1',
        [before.prepared_batch_id],
      );
      return {
        id: before.id,
        duplicate: true,
        qtyBase: before.qty_base,
        remainingBase: rem.rows[0]?.qty_base_remaining ?? '0',
      };
    }

    const pb = await client.query<{
      id: string;
      stock_location_id: string;
      item_id: string;
      batch_id: string | null;
      qty_base_remaining: string;
      outlet_id: string | null;
    }>(
      `select id, stock_location_id, item_id, batch_id, qty_base_remaining::text, outlet_id
         from stock.prepared_batches
        where id = $1 and organization_id = $2 for update`,
      [cmd.preparedBatchId, actor.organizationId],
    );
    const batch = pb.rows[0];
    if (!batch?.outlet_id || batch.outlet_id !== cmd.outletId)
      throw new StockError('not_found', 'Prepared batch not found at this outlet');
    const remaining = Number(batch.qty_base_remaining);
    if (!(remaining > 0)) throw new StockError('conflict', 'Nothing is left in this batch');
    const amount = cmd.qtyBase == null ? remaining : Number(cmd.qtyBase);
    if (amount > remaining + 1e-9)
      throw new StockError(
        'validation',
        `Only ${String(Number(remaining.toFixed(6)))} is left in this batch`,
      );
    const discard = await client.query<{ id: string }>(
      `insert into stock.prepared_batch_discards
         (organization_id, prepared_batch_id, submission_id, qty_base, reason, recorded_by,
          recorded_by_employee)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        actor.organizationId,
        batch.id,
        cmd.submissionId,
        amount.toFixed(6),
        cmd.reason,
        actor.accountId ?? null,
        actor.employeeId ?? null,
      ],
    );
    const discardId = discard.rows[0]?.id;
    if (!discardId) throw new StockError('conflict', 'Could not record the discard');
    const left = await client.query<{ qty_base_remaining: string }>(
      `update stock.prepared_batches
          set qty_base_remaining = greatest(qty_base_remaining - $2, 0),
              discarded_qty_base = discarded_qty_base + $2
        where id = $1 returning qty_base_remaining::text`,
      [batch.id, amount.toFixed(6)],
    );
    await postMovement(client, {
      organizationId: actor.organizationId,
      stockLocationId: batch.stock_location_id,
      itemId: batch.item_id,
      batchId: batch.batch_id,
      quantity: (-amount).toFixed(6),
      movementType: 'wastage',
      sourceDocType: 'prepared_batch_discard',
      sourceDocId: discardId,
      idempotencyKey: `prepared-discard:${discardId}`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
      actorEmployeeId: actor.employeeId ?? null,
      notes: cmd.reason,
    });
    await recordStockAudit(client, {
      action: 'prepared_batch.discarded',
      actorRequest: actor.request,
      accountId: actor.accountId,
      employeeId: actor.employeeId,
      organizationId: actor.organizationId,
      outletId: cmd.outletId,
      subjectType: 'prepared_batch',
      subjectId: batch.id,
      data: { qtyBase: amount.toFixed(6), reason: cmd.reason },
    });
    return {
      id: discardId,
      duplicate: false,
      qtyBase: amount.toFixed(6),
      remainingBase: left.rows[0]?.qty_base_remaining ?? '0',
    };
  });
}
