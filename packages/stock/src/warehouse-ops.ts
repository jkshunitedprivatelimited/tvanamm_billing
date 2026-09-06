import { randomUUID } from 'node:crypto';
import {
  withStockActorContext,
  stockSystemContext,
  type StockPool,
  type StockPoolClient,
} from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { postMovement, pickFefo } from './ledger';
import { buildLabelPayload, type LabelInput } from './labels';

async function warehouseLocations(
  client: StockPoolClient,
  warehouseId: string,
): Promise<Record<string, string>> {
  const { rows } = await client.query<{ kind: string; id: string }>(
    `select kind::text as kind, id from stock.stock_locations
      where warehouse_id = $1 and scope = 'warehouse'`,
    [warehouseId],
  );
  return Object.fromEntries(rows.map((r) => [r.kind, r.id]));
}

// ---- Production ------------------------------------------------------

export interface CreateProductionOrderCommand {
  organizationId: string;
  warehouseId: string;
  outputItemId: string;
  plannedQtyBase: string;
  recipeId?: string | null;
  recipeVersion?: number | null;
}

export async function createProductionOrder(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateProductionOrderCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.production.operate');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.production_orders
         (organization_id, warehouse_id, output_item_id, planned_qty_base, recipe_id,
          recipe_version, started_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        cmd.organizationId,
        cmd.warehouseId,
        cmd.outputItemId,
        cmd.plannedQtyBase,
        cmd.recipeId ?? null,
        cmd.recipeVersion ?? null,
        actor.accountId ?? null,
      ],
    );
    return { id: requireRow(ins, 'production order').id };
  });
}

export interface ProductionInputRequest {
  itemId: string;
  qtyBase: string;
  batchId?: string | null;
}

/** Issue raw materials into a production order, FEFO unless a lot is named. */
export async function issueProductionMaterials(
  pool: StockPool,
  actor: StockActor,
  productionOrderId: string,
  inputs: ProductionInputRequest[],
): Promise<void> {
  ensureStockAllowed(actor, 'stock.production.operate');
  await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const po = await client.query<{
      status: string;
      warehouse_id: string;
      organization_id: string;
    }>('select status, warehouse_id, organization_id from stock.production_orders where id = $1', [
      productionOrderId,
    ]);
    const order = po.rows[0];
    if (!order) throw new StockError('not_found', 'Production order not found');
    if (!['draft', 'materials_issued'].includes(order.status)) {
      throw new StockError('conflict', `Cannot issue materials to a ${order.status} order`);
    }
    const locs = await warehouseLocations(client, order.warehouse_id);
    const sellable = locs.sellable;
    if (!sellable) throw new StockError('not_found', 'Warehouse sellable location missing');

    for (const [index, input] of inputs.entries()) {
      const picks = input.batchId
        ? [{ batchId: input.batchId, quantity: input.qtyBase }]
        : (await pickFefo(client, sellable, input.itemId, input.qtyBase)).picks;
      for (const [pickIndex, pick] of picks.entries()) {
        await postMovement(client, {
          organizationId: order.organization_id,
          stockLocationId: sellable,
          itemId: input.itemId,
          batchId: pick.batchId,
          quantity: (-Number(pick.quantity)).toFixed(6),
          movementType: 'production_input',
          sourceDocType: 'production_order',
          sourceDocId: productionOrderId,
          idempotencyKey: `prod:${productionOrderId}:in:${String(index)}:${String(pickIndex)}`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId ?? null,
        });
        await client.query(
          `insert into stock.production_inputs (production_order_id, item_id, batch_id, qty_base)
           values ($1,$2,$3,$4)`,
          [productionOrderId, input.itemId, pick.batchId, pick.quantity],
        );
      }
    }
    await client.query(
      `update stock.production_orders set status = 'materials_issued' where id = $1`,
      [productionOrderId],
    );
  });
}

export interface RecordProductionOutputCommand {
  outputBatchCode: string;
  expiryDate?: string | null;
  acceptedQtyBase: string;
  rejectedQtyBase?: string;
}

export async function recordProductionOutput(
  pool: StockPool,
  actor: StockActor,
  productionOrderId: string,
  cmd: RecordProductionOutputCommand,
): Promise<{ outputBatchId: string }> {
  ensureStockAllowed(actor, 'stock.production.operate');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const po = await client.query<{
      status: string;
      warehouse_id: string;
      organization_id: string;
      output_item_id: string;
      planned_qty_base: string;
    }>(
      `select status, warehouse_id, organization_id, output_item_id, planned_qty_base
         from stock.production_orders where id = $1`,
      [productionOrderId],
    );
    const order = po.rows[0];
    if (!order) throw new StockError('not_found', 'Production order not found');
    if (order.status !== 'materials_issued') {
      throw new StockError('conflict', `Order must have materials issued, is ${order.status}`);
    }
    const locs = await warehouseLocations(client, order.warehouse_id);
    if (!locs.sellable || !locs.damaged) {
      throw new StockError('not_found', 'Warehouse locations missing');
    }

    const parent = await client.query<{ batch_id: string | null }>(
      `select batch_id from stock.production_inputs
        where production_order_id = $1 and batch_id is not null limit 1`,
      [productionOrderId],
    );
    const batchIns = await client.query<{ id: string }>(
      `insert into stock.batches
         (organization_id, item_id, batch_code, expiry_date, origin, parent_batch_id)
       values ($1,$2,$3,$4,'produced',$5)
       on conflict (item_id, batch_code) do update set expiry_date = excluded.expiry_date
       returning id`,
      [
        order.organization_id,
        order.output_item_id,
        cmd.outputBatchCode,
        cmd.expiryDate ?? null,
        parent.rows[0]?.batch_id ?? null,
      ],
    );
    const outputBatchId = requireRow(batchIns, 'output batch').id;

    const accepted = Number(cmd.acceptedQtyBase);
    const rejected = Number(cmd.rejectedQtyBase ?? '0');
    if (accepted > 0) {
      await postMovement(client, {
        organizationId: order.organization_id,
        stockLocationId: locs.sellable,
        itemId: order.output_item_id,
        batchId: outputBatchId,
        quantity: accepted.toFixed(6),
        movementType: 'production_output',
        sourceDocType: 'production_order',
        sourceDocId: productionOrderId,
        idempotencyKey: `prod:${productionOrderId}:out:accepted`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
      });
      await client.query(
        `insert into stock.production_outputs (production_order_id, batch_id, qty_base, disposition)
         values ($1,$2,$3,'accepted')`,
        [productionOrderId, outputBatchId, accepted.toFixed(6)],
      );
    }
    if (rejected > 0) {
      await postMovement(client, {
        organizationId: order.organization_id,
        stockLocationId: locs.damaged,
        itemId: order.output_item_id,
        batchId: outputBatchId,
        quantity: rejected.toFixed(6),
        movementType: 'production_output',
        sourceDocType: 'production_order',
        sourceDocId: productionOrderId,
        idempotencyKey: `prod:${productionOrderId}:out:rejected`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
      });
      await client.query(
        `insert into stock.production_outputs (production_order_id, batch_id, qty_base, disposition)
         values ($1,$2,$3,'rejected')`,
        [productionOrderId, outputBatchId, rejected.toFixed(6)],
      );
    }

    const loss = Math.max(0, Number(order.planned_qty_base) - accepted - rejected);
    await client.query(
      `update stock.production_orders
          set status = 'produced', output_batch_id = $2, produced_qty_base = $3, loss_qty_base = $4
        where id = $1`,
      [productionOrderId, outputBatchId, accepted.toFixed(6), loss.toFixed(6)],
    );
    return { outputBatchId };
  });
}

export async function postProduction(
  pool: StockPool,
  actor: StockActor,
  productionOrderId: string,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.production.operate');
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const r = await client.query(
      `update stock.production_orders set status = 'posted', posted_by = $2
        where id = $1 and status in ('produced','quality_checked')`,
      [productionOrderId, actor.accountId ?? null],
    );
    if (!r.rowCount) throw new StockError('conflict', 'Production order is not ready to post');
    await recordStockAudit(client, {
      action: 'production_order.posted',
      actorRequest: actor.request,
      accountId: actor.accountId,
      subjectType: 'production_order',
      subjectId: productionOrderId,
    });
  });
}

// ---- Physical counts ---------------------------------------------

export interface OpenStockCountCommand {
  organizationId: string;
  stockLocationId: string;
  countType: 'full' | 'cycle';
  periodLabel?: string | null;
}

export async function openStockCount(
  pool: StockPool,
  actor: StockActor,
  cmd: OpenStockCountCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.count.operate');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const loc = await client.query<{
      warehouse_id: string | null;
      outlet_id: string | null;
      franchise_id: string | null;
    }>('select warehouse_id, outlet_id, franchise_id from stock.stock_locations where id = $1', [
      cmd.stockLocationId,
    ]);
    const l = loc.rows[0];
    if (!l) throw new StockError('not_found', 'Stock location not found');
    const ins = await client.query<{ id: string }>(
      `insert into stock.stock_counts
         (organization_id, stock_location_id, warehouse_id, outlet_id, franchise_id,
          count_type, period_label, opened_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        cmd.organizationId,
        cmd.stockLocationId,
        l.warehouse_id,
        l.outlet_id,
        l.franchise_id,
        cmd.countType,
        cmd.periodLabel ?? null,
        actor.accountId ?? null,
      ],
    );
    return { id: requireRow(ins, 'stock count').id };
  });
}

export interface CountLineInput {
  itemId: string;
  batchId?: string | null;
  countedQtyBase: string;
  reason?: string | null;
}

export async function enterCountLine(
  pool: StockPool,
  actor: StockActor,
  stockCountId: string,
  line: CountLineInput,
): Promise<{ varianceQtyBase: string }> {
  ensureStockAllowed(actor, 'stock.count.operate');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const count = await client.query<{ stock_location_id: string; status: string }>(
      'select stock_location_id, status from stock.stock_counts where id = $1',
      [stockCountId],
    );
    const c = count.rows[0];
    if (!c) throw new StockError('not_found', 'Stock count not found');
    if (!['open', 'counting'].includes(c.status)) {
      throw new StockError('conflict', `Count is ${c.status}`);
    }
    const bal = await client.query<{ on_hand: string }>(
      `select on_hand from stock.stock_balances
        where stock_location_id = $1 and item_id = $2
          and coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
      [c.stock_location_id, line.itemId, line.batchId ?? null],
    );
    const systemQty = bal.rows[0]?.on_hand ?? '0';
    const upsert = await client.query<{ variance_qty_base: string }>(
      `insert into stock.stock_count_lines
         (stock_count_id, item_id, batch_id, system_qty_base, counted_qty_base, reason)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (stock_count_id, item_id, batch_id) do update set
         system_qty_base = excluded.system_qty_base,
         counted_qty_base = excluded.counted_qty_base,
         reason = excluded.reason
       returning variance_qty_base`,
      [
        stockCountId,
        line.itemId,
        line.batchId ?? null,
        systemQty,
        line.countedQtyBase,
        line.reason ?? null,
      ],
    );
    await client.query(
      `update stock.stock_counts set status = 'counting' where id = $1 and status = 'open'`,
      [stockCountId],
    );
    return { varianceQtyBase: requireRow(upsert, 'count line').variance_qty_base };
  });
}

export async function submitCountForReview(
  pool: StockPool,
  actor: StockActor,
  stockCountId: string,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.count.operate');
  await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const r = await client.query(
      `update stock.stock_counts set status = 'review'
        where id = $1 and status in ('open','counting')`,
      [stockCountId],
    );
    if (!r.rowCount) throw new StockError('conflict', 'Count cannot be submitted for review');
    await client.query(
      `insert into stock.count_adjustment_approvals (stock_count_id, requested_by)
       values ($1,$2)
       on conflict (stock_count_id) do update set requested_by = excluded.requested_by`,
      [stockCountId, actor.accountId ?? null],
    );
  });
}

/**
 * Approve a submitted count. The approver must not be the person who submitted
 * it (Core: "nobody approves their own exceptional adjustment"). Each non-zero
 * variance posts an immutable count_adjustment movement.
 */
export async function approveCountAdjustments(
  pool: StockPool,
  actor: StockActor,
  stockCountId: string,
): Promise<{ adjustments: number }> {
  ensureStockAllowed(actor, 'stock.adjustment.approve');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const count = await client.query<{
      status: string;
      stock_location_id: string;
      organization_id: string;
    }>('select status, stock_location_id, organization_id from stock.stock_counts where id = $1', [
      stockCountId,
    ]);
    const c = count.rows[0];
    if (!c) throw new StockError('not_found', 'Stock count not found');
    if (c.status !== 'review')
      throw new StockError('conflict', `Count is ${c.status}, not in review`);

    const approval = await client.query<{ requested_by: string | null }>(
      'select requested_by from stock.count_adjustment_approvals where stock_count_id = $1',
      [stockCountId],
    );
    if (approval.rows[0]?.requested_by && approval.rows[0].requested_by === actor.accountId) {
      throw new StockError('forbidden', 'The submitter cannot approve their own count adjustment');
    }

    const lines = await client.query<{
      id: string;
      item_id: string;
      batch_id: string | null;
      variance_qty_base: string;
    }>(
      `select id, item_id, batch_id, variance_qty_base from stock.stock_count_lines
        where stock_count_id = $1 and variance_qty_base <> 0`,
      [stockCountId],
    );
    let adjustments = 0;
    for (const line of lines.rows) {
      const mv = await postMovement(client, {
        organizationId: c.organization_id,
        stockLocationId: c.stock_location_id,
        itemId: line.item_id,
        batchId: line.batch_id,
        quantity: Number(line.variance_qty_base).toFixed(6),
        movementType: 'count_adjustment',
        sourceDocType: 'stock_count',
        sourceDocId: stockCountId,
        idempotencyKey: `count:${stockCountId}:${line.id}`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
      });
      await client.query(
        'update stock.stock_count_lines set adjustment_movement_id = $2 where id = $1',
        [line.id, mv.movementId],
      );
      adjustments += 1;
    }
    await client.query(
      `update stock.count_adjustment_approvals set approved_by = $2, approved_at = now()
        where stock_count_id = $1`,
      [stockCountId, actor.accountId ?? null],
    );
    await client.query(
      `update stock.stock_counts set status = 'closed', closed_by = $2 where id = $1`,
      [stockCountId, actor.accountId ?? null],
    );
    await recordStockAudit(client, {
      action: 'stock_count.approved',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: c.organization_id,
      subjectType: 'stock_count',
      subjectId: stockCountId,
      data: { adjustments },
    });
    return { adjustments };
  });
}

// ---- Wastage ----------------------------------------------------

export interface RecordWastageCommand {
  organizationId: string;
  stockLocationId: string;
  itemId: string;
  batchId?: string | null;
  qtyBase: string;
  reason:
    | 'spoilage'
    | 'breakage'
    | 'expiry'
    | 'preparation_loss'
    | 'customer_cancelled'
    | 'pest'
    | 'other';
  evidenceUrl?: string | null;
}

export async function recordWastage(
  pool: StockPool,
  actor: StockActor,
  cmd: RecordWastageCommand,
): Promise<{ id: string; movementId: string }> {
  ensureStockAllowed(actor, 'stock.wastage.operate');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const loc = await client.query<{
      warehouse_id: string | null;
      outlet_id: string | null;
      franchise_id: string | null;
    }>('select warehouse_id, outlet_id, franchise_id from stock.stock_locations where id = $1', [
      cmd.stockLocationId,
    ]);
    const l = loc.rows[0];
    if (!l) throw new StockError('not_found', 'Stock location not found');

    const id = randomUUID();
    const mv = await postMovement(client, {
      organizationId: cmd.organizationId,
      stockLocationId: cmd.stockLocationId,
      itemId: cmd.itemId,
      batchId: cmd.batchId ?? null,
      quantity: (-Number(cmd.qtyBase)).toFixed(6),
      movementType: 'wastage',
      sourceDocType: 'wastage_event',
      sourceDocId: id,
      idempotencyKey: `wastage:${id}`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
      notes: cmd.reason,
    });
    await client.query(
      `insert into stock.wastage_events
         (id, organization_id, stock_location_id, warehouse_id, outlet_id, franchise_id,
          item_id, batch_id, qty_base, reason, evidence_url, movement_id, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        cmd.organizationId,
        cmd.stockLocationId,
        l.warehouse_id,
        l.outlet_id,
        l.franchise_id,
        cmd.itemId,
        cmd.batchId ?? null,
        cmd.qtyBase,
        cmd.reason,
        cmd.evidenceUrl ?? null,
        mv.movementId,
        actor.accountId ?? null,
      ],
    );
    return { id, movementId: mv.movementId };
  });
}

// ---- JKSH-owned location transfers ---------------------------

export interface TransferLineInput {
  itemId: string;
  batchId?: string | null;
  qtyBase: string;
}

export interface CreateTransferCommand {
  organizationId: string;
  fromLocationId: string;
  toLocationId: string;
  transferNumber: string;
  lines: TransferLineInput[];
}

export async function createTransfer(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateTransferCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.transfer.operate');
  if (cmd.lines.length === 0) throw new StockError('validation', 'A transfer needs a line');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.stock_transfers
         (organization_id, from_location_id, to_location_id, transfer_number)
       values ($1,$2,$3,$4) returning id`,
      [cmd.organizationId, cmd.fromLocationId, cmd.toLocationId, cmd.transferNumber],
    );
    const id = requireRow(ins, 'transfer').id;
    for (const line of cmd.lines) {
      await client.query(
        `insert into stock.stock_transfer_lines (stock_transfer_id, item_id, batch_id, qty_base)
         values ($1,$2,$3,$4)`,
        [id, line.itemId, line.batchId ?? null, line.qtyBase],
      );
    }
    return { id };
  });
}

export async function dispatchTransfer(
  pool: StockPool,
  actor: StockActor,
  transferId: string,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.transfer.operate');
  await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const t = await client.query<{
      status: string;
      organization_id: string;
      from_location_id: string;
    }>(
      'select status, organization_id, from_location_id from stock.stock_transfers where id = $1',
      [transferId],
    );
    const transfer = t.rows[0];
    if (!transfer) throw new StockError('not_found', 'Transfer not found');
    if (transfer.status !== 'draft') {
      throw new StockError('conflict', `Cannot dispatch a ${transfer.status} transfer`);
    }
    const fromLoc = await client.query<{ warehouse_id: string }>(
      'select warehouse_id from stock.stock_locations where id = $1',
      [transfer.from_location_id],
    );
    const inTransit = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations
          where warehouse_id = $1 and kind = 'in_transit'`,
        [fromLoc.rows[0]?.warehouse_id],
      )
    ).rows[0]?.id;
    if (!inTransit) throw new StockError('not_found', 'in_transit location missing');

    const lines = await client.query<{
      id: string;
      item_id: string;
      batch_id: string | null;
      qty_base: string;
    }>(
      'select id, item_id, batch_id, qty_base from stock.stock_transfer_lines where stock_transfer_id = $1',
      [transferId],
    );
    for (const line of lines.rows) {
      await postMovement(client, {
        organizationId: transfer.organization_id,
        stockLocationId: transfer.from_location_id,
        itemId: line.item_id,
        batchId: line.batch_id,
        quantity: (-Number(line.qty_base)).toFixed(6),
        movementType: 'transfer_out',
        sourceDocType: 'stock_transfer',
        sourceDocId: transferId,
        idempotencyKey: `transfer:${transferId}:out:${line.id}`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
      });
      await postMovement(client, {
        organizationId: transfer.organization_id,
        stockLocationId: inTransit,
        itemId: line.item_id,
        batchId: line.batch_id,
        quantity: Number(line.qty_base).toFixed(6),
        movementType: 'transfer_in',
        sourceDocType: 'stock_transfer',
        sourceDocId: transferId,
        idempotencyKey: `transfer:${transferId}:transit:${line.id}`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
      });
      await client.query(
        'update stock.stock_transfer_lines set dispatched_qty_base = qty_base where id = $1',
        [line.id],
      );
    }
    await client.query(
      `update stock.stock_transfers set status = 'dispatched', dispatched_by = $2 where id = $1`,
      [transferId, actor.accountId ?? null],
    );
  });
}

export interface TransferReceiptInput {
  lineId: string;
  acceptedQtyBase: string;
  damagedQtyBase?: string;
  shortageQtyBase?: string;
}

export async function receiveTransfer(
  pool: StockPool,
  actor: StockActor,
  transferId: string,
  receipts: TransferReceiptInput[],
): Promise<{ status: string }> {
  ensureStockAllowed(actor, 'stock.transfer.operate');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const t = await client.query<{
      status: string;
      organization_id: string;
      from_location_id: string;
      to_location_id: string;
    }>(
      `select status, organization_id, from_location_id, to_location_id
         from stock.stock_transfers where id = $1`,
      [transferId],
    );
    const transfer = t.rows[0];
    if (!transfer) throw new StockError('not_found', 'Transfer not found');
    if (!['dispatched', 'partially_received'].includes(transfer.status)) {
      throw new StockError('conflict', `Cannot receive a ${transfer.status} transfer`);
    }
    const fromWh = (
      await client.query<{ warehouse_id: string }>(
        'select warehouse_id from stock.stock_locations where id = $1',
        [transfer.from_location_id],
      )
    ).rows[0]?.warehouse_id;
    const toWh = (
      await client.query<{ warehouse_id: string }>(
        'select warehouse_id from stock.stock_locations where id = $1',
        [transfer.to_location_id],
      )
    ).rows[0]?.warehouse_id;
    const inTransit = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations where warehouse_id = $1 and kind = 'in_transit'`,
        [fromWh],
      )
    ).rows[0]?.id;
    const damaged = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations where warehouse_id = $1 and kind = 'damaged'`,
        [toWh],
      )
    ).rows[0]?.id;
    if (!inTransit || !damaged) throw new StockError('not_found', 'Warehouse locations missing');

    for (const receipt of receipts) {
      const line = (
        await client.query<{ item_id: string; batch_id: string | null }>(
          'select item_id, batch_id from stock.stock_transfer_lines where id = $1 and stock_transfer_id = $2',
          [receipt.lineId, transferId],
        )
      ).rows[0];
      if (!line) throw new StockError('not_found', 'Transfer line not found');
      const accepted = Number(receipt.acceptedQtyBase);
      const damagedQty = Number(receipt.damagedQtyBase ?? '0');
      const outQty = accepted + damagedQty;
      if (outQty > 0) {
        await postMovement(client, {
          organizationId: transfer.organization_id,
          stockLocationId: inTransit,
          itemId: line.item_id,
          batchId: line.batch_id,
          quantity: (-outQty).toFixed(6),
          movementType: 'transfer_out',
          sourceDocType: 'stock_transfer_receipt',
          sourceDocId: transferId,
          idempotencyKey: `transfer:${transferId}:rcv:transit:${receipt.lineId}`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId ?? null,
        });
      }
      if (accepted > 0) {
        await postMovement(client, {
          organizationId: transfer.organization_id,
          stockLocationId: transfer.to_location_id,
          itemId: line.item_id,
          batchId: line.batch_id,
          quantity: accepted.toFixed(6),
          movementType: 'transfer_in',
          sourceDocType: 'stock_transfer_receipt',
          sourceDocId: transferId,
          idempotencyKey: `transfer:${transferId}:rcv:accepted:${receipt.lineId}`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId ?? null,
        });
      }
      if (damagedQty > 0) {
        await postMovement(client, {
          organizationId: transfer.organization_id,
          stockLocationId: damaged,
          itemId: line.item_id,
          batchId: line.batch_id,
          quantity: damagedQty.toFixed(6),
          movementType: 'transfer_in',
          sourceDocType: 'stock_transfer_receipt',
          sourceDocId: transferId,
          idempotencyKey: `transfer:${transferId}:rcv:damaged:${receipt.lineId}`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId ?? null,
        });
      }
      await client.query(
        `update stock.stock_transfer_lines
            set received_qty_base = received_qty_base + $2,
                damaged_qty_base = damaged_qty_base + $3,
                shortage_qty_base = shortage_qty_base + $4
          where id = $1`,
        [
          receipt.lineId,
          accepted.toFixed(6),
          damagedQty.toFixed(6),
          Number(receipt.shortageQtyBase ?? '0').toFixed(6),
        ],
      );
    }

    const outstanding = await client.query<{ n: string }>(
      `select coalesce(sum(greatest(qty_base - received_qty_base - damaged_qty_base - shortage_qty_base, 0)), 0) as n
         from stock.stock_transfer_lines where stock_transfer_id = $1`,
      [transferId],
    );
    const status = Number(outstanding.rows[0]?.n ?? '0') <= 0 ? 'received' : 'partially_received';
    await client.query(
      `update stock.stock_transfers set status = $2, received_by = $3 where id = $1`,
      [transferId, status, actor.accountId ?? null],
    );
    return { status };
  });
}

// ---- Thermal labels -----------------------------------------

export interface RecordLabelJobCommand {
  organizationId: string;
  itemId: string;
  batchId?: string | null;
  quantity: number;
  template: string;
  paperMm?: 38 | 50 | 58 | 80;
  label: LabelInput;
}

export async function recordLabelJob(
  pool: StockPool,
  actor: StockActor,
  cmd: RecordLabelJobCommand,
): Promise<{ id: string; payload: ReturnType<typeof buildLabelPayload> }> {
  ensureStockAllowed(actor, 'stock.receiving.operate');
  const payload = buildLabelPayload(cmd.label);
  const id = await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.label_jobs
         (organization_id, item_id, batch_id, quantity, template, paper_mm, payload, printed_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        cmd.organizationId,
        cmd.itemId,
        cmd.batchId ?? null,
        cmd.quantity,
        cmd.template,
        cmd.paperMm ?? payload.paperMm,
        JSON.stringify(payload),
        actor.accountId ?? null,
      ],
    );
    return requireRow(ins, 'label job').id;
  });
  return { id, payload };
}

// ---- Document reversal -------------------------------------

export interface ReverseDocumentCommand {
  organizationId: string;
  sourceDocType: string;
  sourceDocId: string;
  reason: string;
}

/**
 * Reverse a posted document by writing one compensating movement per original
 * ledger row (Core Invariant 5: corrections are new documents, never edits).
 * Idempotent: a document can be reversed at most once.
 */
export async function reverseDocument(
  pool: StockPool,
  actor: StockActor,
  cmd: ReverseDocumentCommand,
): Promise<{ reversedMovements: number }> {
  ensureStockAllowed(actor, 'stock.adjustment.approve');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const already = await client.query(
      'select 1 from stock.document_reversals where source_doc_type = $1 and source_doc_id = $2',
      [cmd.sourceDocType, cmd.sourceDocId],
    );
    if (already.rowCount) throw new StockError('conflict', 'Document is already reversed');

    const movements = await client.query<{
      id: string;
      stock_location_id: string;
      item_id: string;
      batch_id: string | null;
      quantity: string;
      unit_cost_paise: string | null;
    }>(
      `select id, stock_location_id, item_id, batch_id, quantity, unit_cost_paise
         from stock.stock_movements
        where source_doc_type = $1 and source_doc_id = $2`,
      [cmd.sourceDocType, cmd.sourceDocId],
    );
    if (movements.rows.length === 0) {
      throw new StockError('not_found', 'No movements to reverse for this document');
    }

    const reversalId = randomUUID();
    for (const mv of movements.rows) {
      await postMovement(client, {
        organizationId: cmd.organizationId,
        stockLocationId: mv.stock_location_id,
        itemId: mv.item_id,
        batchId: mv.batch_id,
        quantity: (-Number(mv.quantity)).toFixed(6),
        movementType: 'adjustment',
        unitCostPaise: mv.unit_cost_paise != null ? Number(mv.unit_cost_paise) : null,
        sourceDocType: `${cmd.sourceDocType}_reversal`,
        sourceDocId: reversalId,
        idempotencyKey: `reversal:${reversalId}:${mv.id}`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
        notes: cmd.reason,
      });
    }
    await client.query(
      `insert into stock.document_reversals
         (id, organization_id, source_doc_type, source_doc_id, reason, reversed_by)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        reversalId,
        cmd.organizationId,
        cmd.sourceDocType,
        cmd.sourceDocId,
        cmd.reason,
        actor.accountId ?? null,
      ],
    );
    await recordStockAudit(client, {
      action: 'document.reversed',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      subjectType: cmd.sourceDocType,
      subjectId: cmd.sourceDocId,
      data: { reason: cmd.reason, reversedMovements: movements.rows.length },
    });
    return { reversedMovements: movements.rows.length };
  });
}
