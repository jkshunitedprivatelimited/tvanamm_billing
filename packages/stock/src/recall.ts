import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { recordStockOutbox } from './events';
import { postMovement } from './ledger';

export interface DraftRecallCommand {
  organizationId: string;
  itemId: string;
  batchId: string;
  reason: string;
}

export async function draftRecall(
  pool: StockPool,
  actor: StockActor,
  cmd: DraftRecallCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.recall.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.recalls (organization_id, item_id, batch_id, reason)
       values ($1,$2,$3,$4)
       on conflict (batch_id) do nothing
       returning id`,
      [cmd.organizationId, cmd.itemId, cmd.batchId, cmd.reason],
    );
    const row = ins.rows[0];
    if (!row) throw new StockError('conflict', 'A recall already exists for this batch');
    return { id: row.id };
  });
}

export interface ActivateRecallResult {
  status: string;
  affectedLocations: number;
  quantityBase: string;
}

/**
 * Activate a recall: the batch is immediately blocked from allocation
 * (batches.status = 'recalled', which pickFefo already excludes), every
 * current holding location is identified, and RecallActivated is emitted
 * (Core Invariant 13).
 */
export async function activateRecall(
  pool: StockPool,
  actor: StockActor,
  recallId: string,
): Promise<ActivateRecallResult> {
  ensureStockAllowed(actor, 'stock.recall.manage');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const r = await client.query<{
      status: string;
      batch_id: string;
      item_id: string;
      organization_id: string;
    }>('select status, batch_id, item_id, organization_id from stock.recalls where id = $1', [
      recallId,
    ]);
    const recall = r.rows[0];
    if (!recall) throw new StockError('not_found', 'Recall not found');
    if (recall.status !== 'draft') {
      throw new StockError('conflict', `Recall is already ${recall.status}`);
    }

    await client.query(
      `update stock.batches set status = 'recalled', recall_id = $2 where id = $1`,
      [recall.batch_id, recallId],
    );

    const holdings = await client.query<{
      stock_location_id: string;
      warehouse_id: string | null;
      outlet_id: string | null;
      on_hand: string;
    }>(
      `select stock_location_id, warehouse_id, outlet_id, on_hand
         from stock.stock_balances where batch_id = $1 and on_hand > 0`,
      [recall.batch_id],
    );
    let total = 0;
    for (const h of holdings.rows) {
      await client.query(
        `insert into stock.recall_locations
           (recall_id, stock_location_id, warehouse_id, outlet_id, qty_identified_base)
         values ($1,$2,$3,$4,$5)
         on conflict (recall_id, stock_location_id) do update set qty_identified_base = excluded.qty_identified_base`,
        [recallId, h.stock_location_id, h.warehouse_id, h.outlet_id, h.on_hand],
      );
      total += Number(h.on_hand);
    }

    const status = holdings.rows.length > 0 ? 'locations_identified' : 'active';
    await client.query(
      `update stock.recalls set status = $2, activated_by = $3, activated_at = now() where id = $1`,
      [recallId, status, actor.accountId ?? null],
    );

    await recordStockAudit(client, {
      action: 'recall.activated',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: recall.organization_id,
      subjectType: 'recall',
      subjectId: recallId,
      data: { affectedLocations: holdings.rows.length, quantityBase: total },
    });
    await recordStockOutbox(client, {
      aggregateType: 'recall',
      aggregateId: recallId,
      eventType: 'RecallActivated',
      payload: {
        recallId,
        itemId: recall.item_id,
        batchId: recall.batch_id,
        affectedLocations: holdings.rows.length,
      },
    });
    return { status, affectedLocations: holdings.rows.length, quantityBase: total.toFixed(6) };
  });
}

/** Move the identified quantity at a location into its quarantine location. */
export async function quarantineRecallLocation(
  pool: StockPool,
  actor: StockActor,
  recallId: string,
  stockLocationId: string,
): Promise<{ quantityBase: string }> {
  ensureStockAllowed(actor, 'stock.recall.manage');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const rl = await client.query<{ qty_identified_base: string; qty_quarantined_base: string }>(
      `select qty_identified_base, qty_quarantined_base from stock.recall_locations
        where recall_id = $1 and stock_location_id = $2`,
      [recallId, stockLocationId],
    );
    const row = rl.rows[0];
    if (!row) throw new StockError('not_found', 'Recall location not found');
    const outstanding = Number(row.qty_identified_base) - Number(row.qty_quarantined_base);
    if (outstanding <= 0) return { quantityBase: '0.000000' };

    const recall = requireRow(
      await client.query<{ batch_id: string; item_id: string; organization_id: string }>(
        'select batch_id, item_id, organization_id from stock.recalls where id = $1',
        [recallId],
      ),
      'recall',
    );
    const loc = requireRow(
      await client.query<{ warehouse_id: string | null }>(
        'select warehouse_id from stock.stock_locations where id = $1',
        [stockLocationId],
      ),
      'location',
    );
    if (!loc.warehouse_id) {
      // Franchise outlet: no local quarantine location; record collection intent.
      await client.query(
        'update stock.recall_locations set qty_quarantined_base = qty_identified_base where recall_id = $1 and stock_location_id = $2',
        [recallId, stockLocationId],
      );
      return { quantityBase: outstanding.toFixed(6) };
    }
    const quarantine = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations where warehouse_id = $1 and kind = 'quarantine'`,
        [loc.warehouse_id],
      )
    ).rows[0]?.id;
    if (!quarantine) throw new StockError('not_found', 'Quarantine location missing');

    await postMovement(client, {
      organizationId: recall.organization_id,
      stockLocationId,
      itemId: recall.item_id,
      batchId: recall.batch_id,
      quantity: (-outstanding).toFixed(6),
      movementType: 'recall_quarantine',
      sourceDocType: 'recall',
      sourceDocId: recallId,
      idempotencyKey: `recall:${recallId}:${stockLocationId}:out`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
    });
    await postMovement(client, {
      organizationId: recall.organization_id,
      stockLocationId: quarantine,
      itemId: recall.item_id,
      batchId: recall.batch_id,
      quantity: outstanding.toFixed(6),
      movementType: 'recall_quarantine',
      sourceDocType: 'recall',
      sourceDocId: recallId,
      idempotencyKey: `recall:${recallId}:${stockLocationId}:in`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
    });
    await client.query(
      'update stock.recall_locations set qty_quarantined_base = qty_identified_base where recall_id = $1 and stock_location_id = $2',
      [recallId, stockLocationId],
    );
    await client.query(
      `update stock.recalls set status = 'quarantined' where id = $1
         and not exists (select 1 from stock.recall_locations
                          where recall_id = $1 and qty_quarantined_base < qty_identified_base)`,
      [recallId],
    );
    return { quantityBase: outstanding.toFixed(6) };
  });
}

export async function acknowledgeRecallLocation(
  pool: StockPool,
  actor: StockActor,
  recallId: string,
  stockLocationId: string,
): Promise<void> {
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    await client.query(
      `update stock.recall_locations set acknowledged_at = now()
        where recall_id = $1 and stock_location_id = $2`,
      [recallId, stockLocationId],
    );
  });
}

export async function closeRecall(
  pool: StockPool,
  actor: StockActor,
  recallId: string,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.recall.manage');
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const r = await client.query(
      `update stock.recalls set status = 'closed', closed_by = $2, closed_at = now()
        where id = $1 and status in ('quarantined','locations_identified','active')`,
      [recallId, actor.accountId ?? null],
    );
    if (!r.rowCount) throw new StockError('conflict', 'Recall cannot be closed from its state');
  });
}

export interface RecallSummary {
  id: string;
  status: string;
  itemId: string;
  batchId: string;
  identifiedBase: string;
  quarantinedBase: string;
  unresolvedBase: string;
  locations: number;
}

export async function getRecall(
  pool: StockPool,
  actor: StockActor,
  recallId: string,
): Promise<RecallSummary> {
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const r = await client.query<{ id: string; status: string; item_id: string; batch_id: string }>(
      'select id, status, item_id, batch_id from stock.recalls where id = $1',
      [recallId],
    );
    const recall = r.rows[0];
    if (!recall) throw new StockError('not_found', 'Recall not found');
    const agg = await client.query<{
      identified: string;
      quarantined: string;
      n: string;
    }>(
      `select coalesce(sum(qty_identified_base),0) as identified,
              coalesce(sum(qty_quarantined_base),0) as quarantined,
              count(*) as n
         from stock.recall_locations where recall_id = $1`,
      [recallId],
    );
    const a = requireRow(agg, 'recall aggregate');
    return {
      id: recall.id,
      status: recall.status,
      itemId: recall.item_id,
      batchId: recall.batch_id,
      identifiedBase: a.identified,
      quarantinedBase: a.quarantined,
      unresolvedBase: (Number(a.identified) - Number(a.quarantined)).toFixed(6),
      locations: Number(a.n),
    };
  });
}
