import { randomUUID } from 'node:crypto';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { assertOutletInFranchise, ensureStockAllowed, type StockActor } from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { postMovement } from './ledger';

export interface RecordLocalInwardCommand {
  organizationId: string;
  outletId: string;
  franchiseId: string;
  itemId: string;
  batchCode?: string | null | undefined;
  expiryDate?: string | null | undefined;
  qtyBase: string;
  unitCostPaise?: number | null | undefined;
  supplierName?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
}

/**
 * Record local (non-JKSH) inward at an outlet. Quantity is mandatory; cost may
 * be pending for owner review. JKSH-required items (official cups / printed
 * packaging) cannot use this path. Employee entry affects physical quantity
 * immediately and is flagged pending_review.
 */
export async function recordLocalInward(
  pool: StockPool,
  actor: StockActor,
  cmd: RecordLocalInwardCommand,
): Promise<{ id: string; valuationState: string }> {
  ensureStockAllowed(actor, 'stock.local_inward.record');
  await assertOutletInFranchise(pool, actor, cmd.outletId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const item = await client.query<{ supply_rule: string }>(
      'select supply_rule::text as supply_rule from stock.items where id = $1',
      [cmd.itemId],
    );
    if (!item.rows[0]) throw new StockError('not_found', 'Item not found');
    if (item.rows[0].supply_rule === 'jksh_required') {
      throw new StockError('forbidden', 'JKSH-required items cannot use local inward');
    }

    const loc = await client.query<{ id: string }>(
      `select id from stock.stock_locations where outlet_id = $1 and scope = 'outlet' and kind = 'sellable'`,
      [cmd.outletId],
    );
    const locationId = loc.rows[0]?.id;
    if (!locationId) throw new StockError('conflict', 'Outlet stock tracking is not configured');

    let batchId: string | null = null;
    if (cmd.batchCode) {
      const b = await client.query<{ id: string }>(
        `insert into stock.batches (organization_id, item_id, batch_code, expiry_date, origin)
         values ($1,$2,$3,$4,'local_inward')
         on conflict (item_id, batch_code) do update set expiry_date = excluded.expiry_date
         returning id`,
        [cmd.organizationId, cmd.itemId, cmd.batchCode, cmd.expiryDate ?? null],
      );
      batchId = requireRow(b, 'batch').id;
    }

    const id = randomUUID();
    const mv = await postMovement(client, {
      organizationId: cmd.organizationId,
      stockLocationId: locationId,
      itemId: cmd.itemId,
      batchId,
      quantity: Number(cmd.qtyBase).toFixed(6),
      movementType: 'receipt',
      unitCostPaise: cmd.unitCostPaise ?? null,
      sourceDocType: 'local_inward',
      sourceDocId: id,
      idempotencyKey: `local_inward:${id}`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
      notes: 'local inward',
    });

    const valuationState = cmd.unitCostPaise != null ? 'costed' : 'cost_pending';
    await client.query(
      `insert into stock.local_inwards
         (id, organization_id, outlet_id, franchise_id, stock_location_id, item_id, batch_id,
          qty_base, unit_cost_paise, supplier_name, invoice_number, valuation_state, movement_id,
          recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        id,
        cmd.organizationId,
        cmd.outletId,
        cmd.franchiseId,
        locationId,
        cmd.itemId,
        batchId,
        Number(cmd.qtyBase).toFixed(6),
        cmd.unitCostPaise ?? null,
        cmd.supplierName ?? null,
        cmd.invoiceNumber ?? null,
        valuationState,
        mv.movementId,
        actor.accountId ?? null,
      ],
    );
    await recordStockAudit(client, {
      action: 'local_inward.recorded',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      franchiseId: cmd.franchiseId,
      outletId: cmd.outletId,
      subjectType: 'local_inward',
      subjectId: id,
      data: { qtyBase: cmd.qtyBase, valuationState },
    });
    return { id, valuationState };
  });
}

export interface ReviewLocalInwardCommand {
  action: 'confirm' | 'reverse';
  unitCostPaise?: number | null | undefined;
  supplierName?: string | null | undefined;
  invoiceNumber?: string | null | undefined;
  reason?: string | null | undefined;
}

/** Owner review: confirm (optionally filling missing cost) or post a reversal. */
export async function reviewLocalInward(
  pool: StockPool,
  actor: StockActor,
  localInwardId: string,
  cmd: ReviewLocalInwardCommand,
): Promise<{ status: string }> {
  ensureStockAllowed(actor, 'stock.local_inward.review');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const li = await client.query<{
      status: string;
      organization_id: string;
      outlet_id: string;
      stock_location_id: string;
      item_id: string;
      batch_id: string | null;
      qty_base: string;
      unit_cost_paise: string | null;
    }>(
      `select status, organization_id, outlet_id, stock_location_id, item_id, batch_id, qty_base,
              unit_cost_paise
         from stock.local_inwards where id = $1`,
      [localInwardId],
    );
    const row = li.rows[0];
    if (!row) throw new StockError('not_found', 'Local inward not found');
    if (row.status !== 'pending_review') {
      throw new StockError('conflict', `Local inward is ${row.status}`);
    }

    if (cmd.action === 'reverse') {
      const linked = await client.query(
        `select 1 from stock.employee_stock_entries where id=$1 and result->>'expenseId' is not null`,
        [localInwardId],
      );
      if (linked.rowCount)
        throw new StockError(
          'conflict',
          'This purchase has a linked expense. Correct the expense and stock count separately so both records remain accurate.',
        );
    }
    if (cmd.action === 'confirm') {
      const cost =
        cmd.unitCostPaise ?? (row.unit_cost_paise != null ? Number(row.unit_cost_paise) : null);
      await client.query(
        `update stock.local_inwards
            set status = 'confirmed', reviewed_by = $2,
                unit_cost_paise = $3::bigint,
                supplier_name = coalesce($4::text, supplier_name),
                invoice_number = coalesce($5::text, invoice_number),
                valuation_state = case when $3::bigint is not null then 'costed'::stock.valuation_state
                                       else 'cost_pending'::stock.valuation_state end
          where id = $1`,
        [
          localInwardId,
          actor.accountId ?? null,
          cost,
          cmd.supplierName ?? null,
          cmd.invoiceNumber ?? null,
        ],
      );
      return { status: 'confirmed' };
    }

    // Reverse: post a compensating negative movement; no posted row is edited.
    await postMovement(client, {
      organizationId: row.organization_id,
      stockLocationId: row.stock_location_id,
      itemId: row.item_id,
      batchId: row.batch_id,
      quantity: (-Number(row.qty_base)).toFixed(6),
      movementType: 'adjustment',
      sourceDocType: 'local_inward_reversal',
      sourceDocId: localInwardId,
      idempotencyKey: `local_inward_reversal:${localInwardId}`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
      notes: cmd.reason ?? 'local inward reversed',
    });
    await client.query(
      `update stock.local_inwards set status = 'reversed', reviewed_by = $2 where id = $1`,
      [localInwardId, actor.accountId ?? null],
    );
    await recordStockAudit(client, {
      action: 'local_inward.reversed',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: row.organization_id,
      outletId: row.outlet_id,
      subjectType: 'local_inward',
      subjectId: localInwardId,
      data: { reason: cmd.reason ?? null },
    });
    return { status: 'reversed' };
  });
}
