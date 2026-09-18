import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { assertOutletInFranchise, ensureStockAllowed, type StockActor } from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { postMovement } from './ledger';

/**
 * A Franchise Owner (or their staff) returning stock JKSH already delivered
 * and the outlet already accepted — wrong item, excess, a defect found after
 * the fact. Distinct from a receiving discrepancy (`resolveDiscrepancy`'s
 * `return_collection`), which covers stock that was never accepted into
 * inventory in the first place.
 *
 * Lifecycle: requested -> approved|rejected -> collected -> received
 * -> credited|replaced|rejected. Each step is a separate capability
 * (`stock.return.request` / `.approve` / `.collect` / `.receive`) held by a
 * different party — the outlet that requests a return never approves it,
 * values its credit, or removes it from its own books. Stock only leaves the
 * outlet's ledger at `collected`, once JKSH actually has the goods in hand;
 * if a post-inspection review at `received` rejects the return, the
 * collection movement is reversed and the stock goes back to the outlet.
 */
export interface RequestReturnCommand {
  organizationId: string;
  outletId: string;
  franchiseId: string;
  itemId: string;
  qtyBase: string;
  reason: string;
}

export async function requestReturn(
  pool: StockPool,
  actor: StockActor,
  cmd: RequestReturnCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.return.request');
  await assertOutletInFranchise(pool, actor, cmd.outletId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const loc = await client.query<{ id: string }>(
      `select id from stock.stock_locations where outlet_id = $1 and scope = 'outlet' and kind = 'sellable'`,
      [cmd.outletId],
    );
    const locationId = loc.rows[0]?.id;
    if (!locationId) throw new StockError('conflict', 'Outlet stock tracking is not configured');

    const item = await client.query<{ is_returnable: boolean }>(
      `select is_returnable from stock.items where id = $1 and organization_id = $2`,
      [cmd.itemId, cmd.organizationId],
    );
    if (!item.rows[0]) throw new StockError('not_found', 'Item not found');
    if (!item.rows[0].is_returnable) {
      throw new StockError('validation', 'This item is not eligible for return');
    }

    const ins = await client.query<{ id: string }>(
      `insert into stock.owner_returns
         (organization_id, outlet_id, franchise_id, stock_location_id, item_id, qty_base, reason,
          requested_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        cmd.organizationId,
        cmd.outletId,
        cmd.franchiseId,
        locationId,
        cmd.itemId,
        cmd.qtyBase,
        cmd.reason,
        actor.accountId ?? null,
      ],
    );
    const id = requireRow(ins, 'return request').id;
    await recordStockAudit(client, {
      action: 'owner_return.requested',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      franchiseId: cmd.franchiseId,
      outletId: cmd.outletId,
      subjectType: 'owner_return',
      subjectId: id,
      data: { itemId: cmd.itemId, qtyBase: cmd.qtyBase },
    });
    return { id };
  });
}

interface ReturnRow {
  status: string;
  organization_id: string;
  outlet_id: string;
  franchise_id: string;
  stock_location_id: string;
  item_id: string;
  qty_base: string;
  collection_movement_id: string | null;
}

async function lockReturn(
  client: Parameters<Parameters<typeof withStockActorContext>[2]>[0],
  returnId: string,
): Promise<ReturnRow> {
  const r = await client.query<ReturnRow>(
    `select status, organization_id, outlet_id, franchise_id, stock_location_id, item_id, qty_base,
            collection_movement_id
       from stock.owner_returns where id = $1 for update`,
    [returnId],
  );
  const row = r.rows[0];
  if (!row) throw new StockError('not_found', 'Return request not found');
  return row;
}

function expectStatus(row: ReturnRow, expected: string) {
  if (row.status !== expected) {
    throw new StockError('conflict', `Return request is ${row.status}, expected ${expected}`);
  }
}

export interface DecideReturnCommand {
  action: 'approve' | 'reject';
  note?: string | null | undefined;
}

/** Central/warehouse agrees the return is legitimate and worth collecting —
 *  no stock movement yet, since JKSH doesn't have the goods. */
export async function decideReturn(
  pool: StockPool,
  actor: StockActor,
  returnId: string,
  cmd: DecideReturnCommand,
): Promise<{ status: string }> {
  ensureStockAllowed(actor, 'stock.return.approve');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const row = await lockReturn(client, returnId);
    expectStatus(row, 'requested');
    // No outlet-scope check here: only central_admin/warehouse_manager hold
    // `stock.return.approve` (the outlet that requested the return cannot),
    // and neither role is scoped to a franchise/outlet the way an owner or
    // operator is — capability + RLS (`owner_returns_update`) are the guard.

    const status = cmd.action === 'approve' ? 'approved' : 'rejected';
    await client.query(
      `update stock.owner_returns
          set status = $2, approved_by = $3, approved_at = now(), approval_note = $4
        where id = $1`,
      [returnId, status, actor.accountId ?? null, cmd.note ?? null],
    );
    await recordStockAudit(client, {
      action: cmd.action === 'approve' ? 'owner_return.approved' : 'owner_return.rejected',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      subjectType: 'owner_return',
      subjectId: returnId,
      data: { note: cmd.note ?? null },
    });
    return { status };
  });
}

/** Warehouse confirms the goods were physically picked up from the outlet.
 *  This is the point the stock actually leaves the outlet's books. */
export async function collectReturn(
  pool: StockPool,
  actor: StockActor,
  returnId: string,
): Promise<{ status: string }> {
  ensureStockAllowed(actor, 'stock.return.collect');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const row = await lockReturn(client, returnId);
    expectStatus(row, 'approved');

    const mv = await postMovement(client, {
      organizationId: row.organization_id,
      stockLocationId: row.stock_location_id,
      itemId: row.item_id,
      quantity: (-Number(row.qty_base)).toFixed(6),
      movementType: 'adjustment',
      sourceDocType: 'owner_return',
      sourceDocId: returnId,
      idempotencyKey: `owner_return:collect:${returnId}`,
      actorRequest: actor.request,
      actorAccountId: actor.accountId ?? null,
      notes: 'owner return collected',
    });

    await client.query(
      `update stock.owner_returns
          set status = 'collected', collected_by = $2, collected_at = now(), collection_movement_id = $3
        where id = $1`,
      [returnId, actor.accountId ?? null, mv.movementId],
    );
    await recordStockAudit(client, {
      action: 'owner_return.collected',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      subjectType: 'owner_return',
      subjectId: returnId,
      data: { movementId: mv.movementId },
    });
    return { status: 'collected' };
  });
}

/** Warehouse marks the goods as arrived and inspected — the step before a
 *  final credit/replace/reject decision. */
export async function receiveReturn(
  pool: StockPool,
  actor: StockActor,
  returnId: string,
  note?: string | null,
): Promise<{ status: string }> {
  ensureStockAllowed(actor, 'stock.return.receive');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const row = await lockReturn(client, returnId);
    expectStatus(row, 'collected');

    await client.query(
      `update stock.owner_returns
          set status = 'received', received_by = $2, received_at = now(), received_note = $3
        where id = $1`,
      [returnId, actor.accountId ?? null, note ?? null],
    );
    await recordStockAudit(client, {
      action: 'owner_return.received',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      subjectType: 'owner_return',
      subjectId: returnId,
      data: { note: note ?? null },
    });
    return { status: 'received' };
  });
}

export interface ResolveReturnCommand {
  outcome: 'credited' | 'replaced' | 'rejected';
  creditAmountPaise?: number | null | undefined;
  note?: string | null | undefined;
}

/** Final disposition after inspection. A post-inspection reject means the
 *  goods didn't match what was approved — the collection is reversed and the
 *  outlet gets its stock back. */
export async function resolveReturn(
  pool: StockPool,
  actor: StockActor,
  returnId: string,
  cmd: ResolveReturnCommand,
): Promise<{ status: string }> {
  ensureStockAllowed(actor, 'stock.return.receive');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const row = await lockReturn(client, returnId);
    expectStatus(row, 'received');
    if (!row.collection_movement_id) {
      throw new StockError('conflict', 'Return has no recorded collection movement');
    }

    let reversalMovementId: string | null = null;
    if (cmd.outcome === 'rejected') {
      const mv = await postMovement(client, {
        organizationId: row.organization_id,
        stockLocationId: row.stock_location_id,
        itemId: row.item_id,
        quantity: Number(row.qty_base).toFixed(6),
        movementType: 'adjustment',
        sourceDocType: 'owner_return',
        sourceDocId: returnId,
        idempotencyKey: `owner_return:reversal:${returnId}`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
        notes: cmd.note ?? 'owner return rejected after inspection — stock reversed to outlet',
      });
      reversalMovementId = mv.movementId;
    }

    await client.query(
      `update stock.owner_returns
          set status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4,
              credit_amount_paise = $5, reversal_movement_id = $6
        where id = $1`,
      [
        returnId,
        cmd.outcome,
        actor.accountId ?? null,
        cmd.note ?? null,
        cmd.outcome === 'credited' ? (cmd.creditAmountPaise ?? null) : null,
        reversalMovementId,
      ],
    );
    await recordStockAudit(client, {
      action: `owner_return.${cmd.outcome}`,
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      subjectType: 'owner_return',
      subjectId: returnId,
      data: { creditAmountPaise: cmd.creditAmountPaise ?? null, reversalMovementId },
    });
    return { status: cmd.outcome };
  });
}

export interface OwnerReturnRow {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  qtyBase: string;
  reason: string;
  status: string;
  creditAmountPaise: number | null;
  decisionNote: string | null;
  createdAt: string;
}

/** Every return request this outlet has ever made, newest first — the
 *  owner's own history plus whatever Central/warehouse needs to decide. */
export async function listOwnerReturns(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<OwnerReturnRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      base_unit: string;
      qty_base: string;
      reason: string;
      status: string;
      credit_amount_paise: string | null;
      resolution_note: string | null;
      approval_note: string | null;
      received_note: string | null;
      created_at: Date;
    }>(
      `select r.id, r.item_id, i.name as item_name, i.base_unit, r.qty_base, r.reason,
              r.status::text as status, r.credit_amount_paise,
              r.resolution_note, r.approval_note, r.received_note, r.created_at
         from stock.owner_returns r
         join stock.items i on i.id = r.item_id
        where r.outlet_id = $1
        order by r.created_at desc
        limit 100`,
      [outletId],
    );
    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      itemName: row.item_name,
      baseUnit: row.base_unit,
      qtyBase: row.qty_base,
      reason: row.reason,
      status: row.status,
      creditAmountPaise: row.credit_amount_paise == null ? null : Number(row.credit_amount_paise),
      decisionNote: row.resolution_note ?? row.received_note ?? row.approval_note,
      createdAt: row.created_at.toISOString(),
    }));
  });
}
