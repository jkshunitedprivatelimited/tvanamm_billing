import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import {
  assertOutletInFranchise,
  assertWarehouseAccess,
  ensureStockAllowed,
  stockContextForActor,
  type StockActor,
} from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';
import { recordStockOutbox } from './events';
import { postMovement, pickFefo } from './ledger';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

interface OrderLineForInvoice {
  hsn_code: string | null;
  qty_base: string;
  unit_price_paise: string;
  gst_rate: string;
}

export interface GstInvoiceLine {
  hsnCode: string | null;
  qtyBase: string;
  gstInclusivePaise: number;
  taxablePaise: number;
  gstPaise: number;
  gstRate: string;
}

export interface GstInvoice {
  lines: GstInvoiceLine[];
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
}

/** GST breakup snapshot for a dispatch, derived from the order-line snapshots. */
export function buildGstInvoice(lines: OrderLineForInvoice[]): GstInvoice {
  const out: GstInvoiceLine[] = [];
  let taxable = 0;
  let gst = 0;
  for (const l of lines) {
    const inclusive = Math.round(Number(l.qty_base) * Number(l.unit_price_paise));
    const rate = Number(l.gst_rate);
    const lineTaxable = Math.round(inclusive / (1 + rate / 100));
    const lineGst = inclusive - lineTaxable;
    taxable += lineTaxable;
    gst += lineGst;
    out.push({
      hsnCode: l.hsn_code,
      qtyBase: l.qty_base,
      gstInclusivePaise: inclusive,
      taxablePaise: lineTaxable,
      gstPaise: lineGst,
      gstRate: l.gst_rate,
    });
  }
  return { lines: out, taxablePaise: taxable, gstPaise: gst, totalPaise: taxable + gst };
}

/** Payment must be server-verified before dispatch (Core Invariant 11). */
export async function approveStockOrder(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.order.oversee');
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const r = await client.query(
      `update stock.stock_orders set status = 'approved' where id = $1 and status = 'paid'`,
      [orderId],
    );
    if (!r.rowCount) throw new StockError('conflict', 'Order must be paid before approval');
    await recordStockAudit(client, {
      action: 'stock_order.approved',
      actorRequest: actor.request,
      accountId: actor.accountId,
      subjectType: 'stock_order',
      subjectId: orderId,
    });
  });
}

export interface AllocateResult {
  status: string;
  fullyAllocated: boolean;
}

/** FEFO-allocate a warehouse against an approved order; partial is allowed. */
export async function allocateStockOrder(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
  warehouseId: string,
): Promise<AllocateResult> {
  ensureStockAllowed(actor, 'stock.dispatch.operate');
  assertWarehouseAccess(actor, warehouseId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    // Serialise concurrent allocation of the same order.
    const order = await client.query<{ status: string; organization_id: string }>(
      'select status, organization_id from stock.stock_orders where id = $1 for update',
      [orderId],
    );
    if (!order.rows[0]) throw new StockError('not_found', 'Stock order not found');
    if (!['approved', 'allocated'].includes(order.rows[0].status)) {
      throw new StockError('conflict', `Cannot allocate a ${order.rows[0].status} order`);
    }
    const wh = await client.query<{ organization_id: string }>(
      'select organization_id from stock.warehouses where id = $1',
      [warehouseId],
    );
    if (!wh.rows[0]) throw new StockError('not_found', 'Warehouse not found');
    if (wh.rows[0].organization_id !== order.rows[0].organization_id) {
      throw new StockError('validation', 'Warehouse and order belong to different organizations');
    }
    const sellable = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations where warehouse_id = $1 and kind = 'sellable'`,
        [warehouseId],
      )
    ).rows[0]?.id;
    if (!sellable) throw new StockError('not_found', 'Warehouse sellable location missing');

    const lines = await client.query<{
      id: string;
      item_id: string;
      qty_base: string;
      allocated_qty_base: string;
    }>(
      `select id, item_id, qty_base, allocated_qty_base from stock.stock_order_lines
        where stock_order_id = $1 for update`,
      [orderId],
    );

    let fullyAllocated = true;
    for (const line of lines.rows) {
      const outstanding = Number(line.qty_base) - Number(line.allocated_qty_base);
      if (outstanding <= 0) continue;
      // Lock every balance row for this (location, item) so a concurrent
      // allocation for another order cannot double-count the same usable stock.
      await client.query(
        `select 1 from stock.stock_balances
          where stock_location_id = $1 and item_id = $2 for update`,
        [sellable, line.item_id],
      );
      const { picks } = await pickFefo(client, sellable, line.item_id, outstanding.toFixed(6));
      let allocated = 0;
      for (const pick of picks) {
        await client.query(
          `insert into stock.stock_order_allocations
             (stock_order_line_id, warehouse_id, batch_id, qty_base)
           values ($1,$2,$3,$4)`,
          [line.id, warehouseId, pick.batchId, pick.quantity],
        );
        await client.query(
          `update stock.stock_balances set allocated = allocated + $4, updated_at = now()
            where stock_location_id = $1 and item_id = $2
              and coalesce(batch_id, '${NIL_UUID}'::uuid) = coalesce($3::uuid, '${NIL_UUID}'::uuid)`,
          [sellable, line.item_id, pick.batchId, pick.quantity],
        );
        allocated += Number(pick.quantity);
      }
      if (allocated > 0) {
        await client.query(
          'update stock.stock_order_lines set allocated_qty_base = allocated_qty_base + $2 where id = $1',
          [line.id, allocated.toFixed(6)],
        );
      }
      if (allocated + 1e-9 < outstanding) fullyAllocated = false;
    }

    const status = 'allocated';
    await client.query('update stock.stock_orders set status = $2 where id = $1', [
      orderId,
      status,
    ]);
    return { status, fullyAllocated };
  });
}

export interface DispatchResult {
  dispatchId: string;
  status: string;
}

/** Pack and dispatch held allocations; remainder stays backordered. */
export async function dispatchStockOrder(
  pool: StockPool,
  actor: StockActor,
  orderId: string,
  opts: { dispatchNumber: string; warehouseId: string },
): Promise<DispatchResult> {
  ensureStockAllowed(actor, 'stock.dispatch.operate');
  assertWarehouseAccess(actor, opts.warehouseId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const order = await client.query<{
      status: string;
      organization_id: string;
      outlet_id: string;
      franchise_id: string;
    }>(
      'select status, organization_id, outlet_id, franchise_id from stock.stock_orders where id = $1 for update',
      [orderId],
    );
    const o = order.rows[0];
    if (!o) throw new StockError('not_found', 'Stock order not found');
    if (!['allocated', 'partially_dispatched'].includes(o.status)) {
      throw new StockError('payment_unverified', `Cannot dispatch a ${o.status} order`);
    }
    const wh = await client.query<{ organization_id: string }>(
      'select organization_id from stock.warehouses where id = $1',
      [opts.warehouseId],
    );
    if (!wh.rows[0]) throw new StockError('not_found', 'Warehouse not found');
    if (wh.rows[0].organization_id !== o.organization_id) {
      throw new StockError('validation', 'Warehouse and order belong to different organizations');
    }
    const sellable = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations where warehouse_id = $1 and kind = 'sellable'`,
        [opts.warehouseId],
      )
    ).rows[0]?.id;
    if (!sellable) throw new StockError('not_found', 'Warehouse sellable location missing');

    // Only allocations held IN THIS WAREHOUSE are dispatched here; locked so a
    // concurrent dispatch cannot pick them up too.
    const held = await client.query<{
      id: string;
      stock_order_line_id: string;
      batch_id: string | null;
      qty_base: string;
      item_id: string;
      hsn_code: string | null;
      unit_price_paise: string;
      gst_rate: string;
    }>(
      `select a.id, a.stock_order_line_id, a.batch_id, a.qty_base, l.item_id,
              l.hsn_code, l.unit_price_paise, l.gst_rate
         from stock.stock_order_allocations a
         join stock.stock_order_lines l on l.id = a.stock_order_line_id
        where l.stock_order_id = $1 and a.status = 'held' and a.warehouse_id = $2
        for update of a`,
      [orderId, opts.warehouseId],
    );
    if (held.rows.length === 0) throw new StockError('conflict', 'Nothing allocated to dispatch');

    // Invoice ONLY the quantities in this dispatch, not the whole order.
    const invoice = buildGstInvoice(
      held.rows.map((h) => ({
        hsn_code: h.hsn_code,
        qty_base: h.qty_base,
        unit_price_paise: h.unit_price_paise,
        gst_rate: h.gst_rate,
      })),
    );

    const dispatchIns = await client.query<{ id: string }>(
      `insert into stock.stock_dispatches
         (organization_id, stock_order_id, warehouse_id, dispatch_number, gst_invoice, status,
          dispatched_by, dispatched_at)
       values ($1,$2,$3,$4,$5,'dispatched',$6, now()) returning id`,
      [
        o.organization_id,
        orderId,
        opts.warehouseId,
        opts.dispatchNumber,
        JSON.stringify(invoice),
        actor.accountId ?? null,
      ],
    );
    const dispatchId = requireRow(dispatchIns, 'dispatch').id;

    for (const alloc of held.rows) {
      await postMovement(client, {
        organizationId: o.organization_id,
        stockLocationId: sellable,
        itemId: alloc.item_id,
        batchId: alloc.batch_id,
        quantity: (-Number(alloc.qty_base)).toFixed(6),
        movementType: 'issue',
        sourceDocType: 'stock_dispatch',
        sourceDocId: dispatchId,
        idempotencyKey: `dispatch:${dispatchId}:${alloc.id}`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
      });
      await client.query(
        `update stock.stock_balances set allocated = greatest(0, allocated - $4), updated_at = now()
          where stock_location_id = $1 and item_id = $2
            and coalesce(batch_id, '${NIL_UUID}'::uuid) = coalesce($3::uuid, '${NIL_UUID}'::uuid)`,
        [sellable, alloc.item_id, alloc.batch_id, alloc.qty_base],
      );
      await client.query(
        `insert into stock.stock_dispatch_lines
           (stock_dispatch_id, stock_order_line_id, item_id, batch_id, qty_base)
         values ($1,$2,$3,$4,$5)`,
        [dispatchId, alloc.stock_order_line_id, alloc.item_id, alloc.batch_id, alloc.qty_base],
      );
      await client.query(
        `update stock.stock_order_allocations set status = 'dispatched' where id = $1`,
        [alloc.id],
      );
      await client.query(
        'update stock.stock_order_lines set dispatched_qty_base = dispatched_qty_base + $2 where id = $1',
        [alloc.stock_order_line_id, alloc.qty_base],
      );
    }

    const outstanding = await client.query<{ n: string }>(
      `select coalesce(sum(greatest(qty_base - dispatched_qty_base, 0)), 0) as n
         from stock.stock_order_lines where stock_order_id = $1`,
      [orderId],
    );
    const status =
      Number(outstanding.rows[0]?.n ?? '0') <= 0 ? 'dispatched' : 'partially_dispatched';
    await client.query('update stock.stock_orders set status = $2 where id = $1', [
      orderId,
      status,
    ]);

    await recordStockOutbox(client, {
      aggregateType: 'stock_order',
      aggregateId: orderId,
      eventType: 'StockOrderDispatched',
      payload: {
        stockOrderId: orderId,
        dispatchId,
        outletId: o.outlet_id,
        franchiseId: o.franchise_id,
        status,
      },
    });
    await recordStockAudit(client, {
      action: 'stock_order.dispatched',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: o.organization_id,
      subjectType: 'stock_dispatch',
      subjectId: dispatchId,
      data: { status, lineCount: held.rows.length },
    });
    return { dispatchId, status };
  });
}

export interface OutletInwardLineInput {
  stockDispatchLineId: string;
  acceptedQtyBase: string;
  shortQtyBase?: string | undefined;
  damagedQtyBase?: string | undefined;
  excessQtyBase?: string | undefined;
  rejectedQtyBase?: string | undefined;
}

export interface RecordOutletInwardCommand {
  organizationId: string;
  stockOrderId: string;
  stockDispatchId: string;
  outletId: string;
  franchiseId: string;
  inwardNumber: string;
  lines: OutletInwardLineInput[];
}

export async function recordOutletInward(
  pool: StockPool,
  actor: StockActor,
  cmd: RecordOutletInwardCommand,
): Promise<{ inwardId: string; status: string; discrepancies: number }> {
  ensureStockAllowed(actor, 'stock.inward.operate');
  await assertOutletInFranchise(pool, actor, cmd.outletId);
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    // Lock the dispatch row so two concurrent inwards against it are serialised
    // and cannot both pass the per-line quantity cap.
    const chain = await client.query<{
      order_outlet: string;
      order_franchise: string;
      order_org: string;
      dispatch_order: string;
      dispatch_org: string;
    }>(
      `select o.outlet_id as order_outlet, o.franchise_id as order_franchise,
              o.organization_id as order_org,
              d.stock_order_id as dispatch_order, d.organization_id as dispatch_org
         from stock.stock_dispatches d
         join stock.stock_orders o on o.id = d.stock_order_id
        where d.id = $1
        for update of d`,
      [cmd.stockDispatchId],
    );
    const c = chain.rows[0];
    if (!c) throw new StockError('not_found', 'Dispatch not found');
    if (c.dispatch_order !== cmd.stockOrderId) {
      throw new StockError('validation', 'Dispatch does not belong to this order');
    }
    if (c.order_outlet !== cmd.outletId || c.order_franchise !== cmd.franchiseId) {
      throw new StockError('validation', 'Order outlet / franchise mismatch');
    }
    if (c.order_org !== cmd.organizationId || c.dispatch_org !== cmd.organizationId) {
      throw new StockError('validation', 'Organization mismatch on the order / dispatch');
    }

    const sellable = (
      await client.query<{ id: string }>(
        `select id from stock.stock_locations where outlet_id = $1 and scope = 'outlet' and kind = 'sellable'`,
        [cmd.outletId],
      )
    ).rows[0]?.id;
    if (!sellable) throw new StockError('conflict', 'Outlet stock tracking is not configured');

    const inwardIns = await client.query<{ id: string }>(
      `insert into stock.outlet_inwards
         (organization_id, stock_order_id, stock_dispatch_id, outlet_id, franchise_id,
          inward_number, status, received_by)
       values ($1,$2,$3,$4,$5,$6,'draft',$7) returning id`,
      [
        cmd.organizationId,
        cmd.stockOrderId,
        cmd.stockDispatchId,
        cmd.outletId,
        cmd.franchiseId,
        cmd.inwardNumber,
        actor.accountId ?? null,
      ],
    );
    const inwardId = requireRow(inwardIns, 'outlet inward').id;

    let discrepancies = 0;
    for (const [index, line] of cmd.lines.entries()) {
      const dl = (
        await client.query<{
          item_id: string;
          batch_id: string | null;
          stock_order_line_id: string;
          qty_base: string;
        }>(
          `select item_id, batch_id, stock_order_line_id, qty_base
             from stock.stock_dispatch_lines
            where id = $1 and stock_dispatch_id = $2`,
          [line.stockDispatchLineId, cmd.stockDispatchId],
        )
      ).rows[0];
      if (!dl) throw new StockError('not_found', 'Dispatch line not found on this dispatch');

      // Guard against repeated inward and quantities exceeding the dispatch.
      const priorRows = await client.query<{ prior: string }>(
        `select coalesce(sum(accepted_qty_base + short_qty_base + damaged_qty_base + rejected_qty_base), 0) as prior
           from stock.outlet_inward_lines where stock_dispatch_line_id = $1`,
        [line.stockDispatchLineId],
      );
      const prior = Number(priorRows.rows[0]?.prior ?? '0');
      const accepted = Number(line.acceptedQtyBase);
      const thisNonExcess =
        accepted +
        Number(line.shortQtyBase ?? '0') +
        Number(line.damagedQtyBase ?? '0') +
        Number(line.rejectedQtyBase ?? '0');
      if (prior + thisNonExcess > Number(dl.qty_base) + 1e-9) {
        throw new StockError('conflict', 'Inward quantity exceeds the dispatched quantity', {
          details: { dispatchLineId: line.stockDispatchLineId, dispatched: dl.qty_base },
        });
      }
      await client.query(
        `insert into stock.outlet_inward_lines
           (outlet_inward_id, stock_dispatch_line_id, item_id, accepted_qty_base, short_qty_base,
            damaged_qty_base, excess_qty_base, rejected_qty_base)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          inwardId,
          line.stockDispatchLineId,
          dl.item_id,
          accepted.toFixed(6),
          Number(line.shortQtyBase ?? '0').toFixed(6),
          Number(line.damagedQtyBase ?? '0').toFixed(6),
          Number(line.excessQtyBase ?? '0').toFixed(6),
          Number(line.rejectedQtyBase ?? '0').toFixed(6),
        ],
      );

      if (accepted > 0) {
        await postMovement(client, {
          organizationId: cmd.organizationId,
          stockLocationId: sellable,
          itemId: dl.item_id,
          batchId: dl.batch_id,
          quantity: accepted.toFixed(6),
          movementType: 'transfer_in',
          sourceDocType: 'outlet_inward',
          sourceDocId: inwardId,
          idempotencyKey: `inward:${inwardId}:${String(index)}:accepted`,
          actorRequest: actor.request,
          actorAccountId: actor.accountId ?? null,
        });
        await client.query(
          'update stock.stock_order_lines set received_qty_base = received_qty_base + $2 where id = $1',
          [dl.stock_order_line_id, accepted.toFixed(6)],
        );
      }

      for (const [kind, qtyStr] of [
        ['short', line.shortQtyBase],
        ['damaged', line.damagedQtyBase],
        ['excess', line.excessQtyBase],
        ['rejected', line.rejectedQtyBase],
      ] as const) {
        const qty = Number(qtyStr ?? '0');
        if (qty > 0) {
          await client.query(
            `insert into stock.stock_order_discrepancies
               (organization_id, outlet_inward_id, stock_order_line_id, item_id, kind, qty_base)
             values ($1,$2,$3,$4,$5,$6)`,
            [
              cmd.organizationId,
              inwardId,
              dl.stock_order_line_id,
              dl.item_id,
              kind,
              qty.toFixed(6),
            ],
          );
          discrepancies += 1;
        }
      }
    }

    const orderLines = await client.query<{ n: string }>(
      `select coalesce(sum(greatest(dispatched_qty_base - received_qty_base, 0)), 0) as n
         from stock.stock_order_lines where stock_order_id = $1`,
      [cmd.stockOrderId],
    );
    const inwardStatus =
      Number(orderLines.rows[0]?.n ?? '0') <= 0 ? 'received' : 'partially_received';
    await client.query('update stock.outlet_inwards set status = $2 where id = $1', [
      inwardId,
      inwardStatus,
    ]);
    await client.query(
      `update stock.stock_orders set status = $2
        where id = $1 and status in ('dispatched','partially_dispatched','partially_received')`,
      [cmd.stockOrderId, inwardStatus],
    );

    await recordStockAudit(client, {
      action: 'outlet_inward.recorded',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      franchiseId: cmd.franchiseId,
      outletId: cmd.outletId,
      subjectType: 'outlet_inward',
      subjectId: inwardId,
      data: { status: inwardStatus, discrepancies },
    });
    return { inwardId, status: inwardStatus, discrepancies };
  });
}

export interface ResolveDiscrepancyOptions {
  creditNoteNumber?: string | undefined;
  amountPaise?: number | undefined;
  reason?: string | undefined;
}

export async function resolveDiscrepancy(
  pool: StockPool,
  actor: StockActor,
  discrepancyId: string,
  resolution:
    'replacement' | 'credit_note' | 'approved_excess' | 'return_collection' | 'written_off',
  opts: ResolveDiscrepancyOptions = {},
): Promise<{ creditNoteId?: string }> {
  ensureStockAllowed(actor, 'stock.order.oversee');
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const d = await client.query<{
      status: string;
      kind: string;
      qty_base: string;
      item_id: string;
      organization_id: string;
      outlet_inward_id: string;
      stock_order_line_id: string;
    }>(
      `select status, kind, qty_base, item_id, organization_id, outlet_inward_id, stock_order_line_id
         from stock.stock_order_discrepancies where id = $1`,
      [discrepancyId],
    );
    const disc = d.rows[0];
    if (!disc) throw new StockError('not_found', 'Discrepancy not found');
    if (disc.status !== 'open') throw new StockError('conflict', 'Discrepancy already resolved');

    let creditNoteId: string | undefined;

    if (resolution === 'approved_excess') {
      if (disc.kind !== 'excess') {
        throw new StockError('validation', 'approved_excess only applies to an excess discrepancy');
      }
      const inward = (
        await client.query<{ outlet_id: string }>(
          'select outlet_id from stock.outlet_inwards where id = $1',
          [disc.outlet_inward_id],
        )
      ).rows[0];
      const sellable = (
        await client.query<{ id: string }>(
          `select id from stock.stock_locations where outlet_id = $1 and kind = 'sellable'`,
          [inward?.outlet_id],
        )
      ).rows[0]?.id;
      if (!sellable) throw new StockError('conflict', 'Outlet stock tracking is not configured');
      await postMovement(client, {
        organizationId: disc.organization_id,
        stockLocationId: sellable,
        itemId: disc.item_id,
        quantity: Number(disc.qty_base).toFixed(6),
        movementType: 'adjustment',
        sourceDocType: 'discrepancy_excess',
        sourceDocId: discrepancyId,
        idempotencyKey: `discrepancy:${discrepancyId}:excess`,
        actorRequest: actor.request,
        actorAccountId: actor.accountId ?? null,
        notes: 'approved excess receipt',
      });
    }

    if (resolution === 'credit_note') {
      const line = (
        await client.query<{ unit_price_paise: string; stock_order_id: string }>(
          'select unit_price_paise, stock_order_id from stock.stock_order_lines where id = $1',
          [disc.stock_order_line_id],
        )
      ).rows[0];
      const amount =
        opts.amountPaise ??
        Math.round(Number(disc.qty_base) * Number(line?.unit_price_paise ?? '0'));
      if (amount <= 0) throw new StockError('validation', 'Credit note amount must be positive');
      const cn = await client.query<{ id: string }>(
        `insert into stock.credit_notes
           (organization_id, stock_order_id, discrepancy_id, credit_note_number, amount_paise, reason, created_by)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [
          disc.organization_id,
          line?.stock_order_id,
          discrepancyId,
          opts.creditNoteNumber ?? `CN-${discrepancyId.slice(0, 8)}`,
          amount,
          opts.reason ?? `${disc.kind} on inward`,
          actor.accountId ?? null,
        ],
      );
      creditNoteId = requireRow(cn, 'credit note').id;
    }

    await client.query(
      `update stock.stock_order_discrepancies
          set status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now()
        where id = $1`,
      [discrepancyId, resolution, actor.accountId ?? null],
    );
    await recordStockAudit(client, {
      action: 'discrepancy.resolved',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: disc.organization_id,
      subjectType: 'discrepancy',
      subjectId: discrepancyId,
      data: { resolution, creditNoteId: creditNoteId ?? null },
    });
    return creditNoteId ? { creditNoteId } : {};
  });
}

export async function getDispatch(
  pool: StockPool,
  actor: StockActor,
  dispatchId: string,
): Promise<{ id: string; status: string; gstInvoice: GstInvoice; lineCount: number }> {
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      gst_invoice: GstInvoice;
    }>('select id, status, gst_invoice from stock.stock_dispatches where id = $1', [dispatchId]);
    const d = rows[0];
    if (!d) throw new StockError('not_found', 'Dispatch not found');
    const count = await client.query<{ n: string }>(
      'select count(*) as n from stock.stock_dispatch_lines where stock_dispatch_id = $1',
      [dispatchId],
    );
    return {
      id: d.id,
      status: d.status,
      gstInvoice: d.gst_invoice,
      lineCount: Number(count.rows[0]?.n ?? '0'),
    };
  });
}
