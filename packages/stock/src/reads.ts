import { withStockActorContext, type StockPool } from '@jksh/db';
import {
  assertOutletInFranchise,
  ensureStockAllowed,
  stockContextForActor,
  type StockActor,
} from './authorize';

/** Small RLS-scoped list reads for the Central / Warehouse admin screens. */

export interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  timezone: string;
  isActive: boolean;
  locations: { id: string; kind: string; name: string }[];
}

export async function listWarehouses(pool: StockPool, actor: StockActor): Promise<WarehouseRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const wh = await client.query<{
      id: string;
      code: string;
      name: string;
      timezone: string;
      is_active: boolean;
    }>(
      `select id, code, name, timezone, is_active from stock.warehouses
        where organization_id = $1 and is_active order by name`,
      [actor.organizationId],
    );
    if (wh.rows.length === 0) return [];
    const locs = await client.query<{
      warehouse_id: string;
      id: string;
      kind: string;
      name: string;
    }>(
      `select warehouse_id, id, kind::text as kind, name from stock.stock_locations
        where warehouse_id = any($1::uuid[]) order by kind`,
      [wh.rows.map((r) => r.id)],
    );
    return wh.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      timezone: r.timezone,
      isActive: r.is_active,
      locations: locs.rows
        .filter((l) => l.warehouse_id === r.id)
        .map((l) => ({ id: l.id, kind: l.kind, name: l.name })),
    }));
  });
}

export interface SupplierRow {
  id: string;
  name: string;
  gstin: string | null;
  isApproved: boolean;
  isActive: boolean;
}

export async function listSuppliers(pool: StockPool, actor: StockActor): Promise<SupplierRow[]> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      gstin: string | null;
      is_approved: boolean;
      is_active: boolean;
    }>(
      `select id, name, gstin, is_approved, is_active from stock.suppliers
        where organization_id = $1 and is_active order by name`,
      [actor.organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      gstin: r.gstin,
      isApproved: r.is_approved,
      isActive: r.is_active,
    }));
  });
}

export interface RecipeRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  currentVersion: number;
  sopDraft: unknown;
  billingMenuItemId: string | null;
  billingAddonId: string | null;
}

export async function listRecipes(pool: StockPool, actor: StockActor): Promise<RecipeRow[]> {
  ensureStockAllowed(actor, 'stock.recipe.read');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      kind: string;
      status: string;
      current_version: number;
      sop_draft: unknown;
      billing_menu_item_id: string | null;
      billing_addon_id: string | null;
    }>(
      `select id, name, kind::text as kind, status::text as status, current_version,
              billing_menu_item_id, billing_addon_id, sop_draft
         from stock.recipes where organization_id = $1 and status <> 'archived' order by name`,
      [actor.organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      status: r.status,
      currentVersion: r.current_version,
      sopDraft: r.sop_draft,
      billingMenuItemId: r.billing_menu_item_id,
      billingAddonId: r.billing_addon_id,
    }));
  });
}

export interface RecallRow {
  id: string;
  status: string;
  itemId: string;
  itemName: string;
  batchCode: string;
  reason: string;
  identifiedBase: string;
  quarantinedBase: string;
}

export async function listRecalls(pool: StockPool, actor: StockActor): Promise<RecallRow[]> {
  ensureStockAllowed(actor, 'stock.recipe.read');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      status: string;
      item_id: string;
      item_name: string;
      batch_code: string;
      reason: string;
      identified: string;
      quarantined: string;
    }>(
      `select r.id, r.status::text as status, r.item_id, i.name as item_name, b.batch_code, r.reason,
              coalesce((select sum(qty_identified_base) from stock.recall_locations rl where rl.recall_id = r.id), 0) as identified,
              coalesce((select sum(qty_quarantined_base) from stock.recall_locations rl where rl.recall_id = r.id), 0) as quarantined
         from stock.recalls r
         join stock.items i on i.id = r.item_id
         join stock.batches b on b.id = r.batch_id
        where r.organization_id = $1 and i.is_active order by r.created_at desc limit 100`,
      [actor.organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      itemId: r.item_id,
      itemName: r.item_name,
      batchCode: r.batch_code,
      reason: r.reason,
      identifiedBase: r.identified,
      quarantinedBase: r.quarantined,
    }));
  });
}

export interface FulfilmentOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  outletId: string;
  franchiseId: string;
  totalPaise: number;
  lines: number;
}

/** Paid / in-flight orders that the warehouse still has to act on. */
export async function listOrdersForFulfilment(
  pool: StockPool,
  actor: StockActor,
): Promise<FulfilmentOrderRow[]> {
  ensureStockAllowed(actor, 'stock.order.oversee');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      order_number: string;
      status: string;
      outlet_id: string;
      franchise_id: string;
      total_paise: string;
      n: string;
    }>(
      `select o.id, o.order_number, o.status::text as status, o.outlet_id, o.franchise_id,
              o.total_paise,
              (select count(*) from stock.stock_order_lines l where l.stock_order_id = o.id) as n
         from stock.stock_orders o
        where o.organization_id = $1
          and exists (select 1 from stock.outlet_stock_settings s where s.outlet_id=o.outlet_id and s.tracking_enabled)
          and o.status in ('paid','approved','allocated','partially_dispatched','dispatched',
                           'partially_received')
        order by o.created_at asc limit 100`,
      [actor.organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      outletId: r.outlet_id,
      franchiseId: r.franchise_id,
      totalPaise: Number(r.total_paise),
      lines: Number(r.n),
    }));
  });
}

export interface PurchaseOrderDetail {
  id: string;
  poNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseCode: string;
  expectedDate: string | null;
  totalPaise: number;
  lines: {
    id: string;
    itemId: string;
    itemName: string;
    baseUnit: string;
    orderQtyBase: string;
    receivedQtyBase: string;
    unitPricePaise: number;
    gstRate: string;
  }[];
}

export async function getPurchaseOrder(
  pool: StockPool,
  actor: StockActor,
  poId: string,
): Promise<PurchaseOrderDetail | null> {
  ensureStockAllowed(actor, 'stock.supplier.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      po_number: string;
      status: string;
      supplier_id: string;
      supplier_name: string;
      warehouse_id: string;
      warehouse_code: string;
      expected_date: string | null;
      total_paise: string;
    }>(
      `select p.id, p.po_number, p.status::text as status, p.supplier_id, s.name as supplier_name,
              p.warehouse_id, w.code as warehouse_code, p.expected_date::text as expected_date,
              p.total_paise
         from stock.purchase_orders p
         join stock.suppliers s on s.id = p.supplier_id
         join stock.warehouses w on w.id = p.warehouse_id
        where p.id = $1 and p.organization_id = $2`,
      [poId, actor.organizationId],
    );
    const po = rows[0];
    if (!po) return null;
    const lines = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      base_unit: string;
      order_qty_base: string;
      received_qty_base: string;
      unit_price_paise: string;
      gst_rate: string;
    }>(
      `select l.id, l.item_id, i.name as item_name, i.base_unit,
              l.order_qty_base, l.received_qty_base, l.unit_price_paise, l.gst_rate
         from stock.purchase_order_lines l
         join stock.items i on i.id = l.item_id
        where l.purchase_order_id = $1
        order by i.name`,
      [poId],
    );
    return {
      id: po.id,
      poNumber: po.po_number,
      status: po.status,
      supplierId: po.supplier_id,
      supplierName: po.supplier_name,
      warehouseId: po.warehouse_id,
      warehouseCode: po.warehouse_code,
      expectedDate: po.expected_date,
      totalPaise: Number(po.total_paise),
      lines: lines.rows.map((l) => ({
        id: l.id,
        itemId: l.item_id,
        itemName: l.item_name,
        baseUnit: l.base_unit,
        orderQtyBase: l.order_qty_base,
        receivedQtyBase: l.received_qty_base,
        unitPricePaise: Number(l.unit_price_paise),
        gstRate: l.gst_rate,
      })),
    };
  });
}

/** The outlet's own sellable location — every outlet-facing write (local
 *  inward, counts, wastage) targets this one location, but the owner should
 *  never need to know a "stock location" concept exists. */
export async function getOutletSellableLocation(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<{ id: string } | null> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from stock.stock_locations where outlet_id = $1 and scope = 'outlet' and kind = 'sellable'`,
      [outletId],
    );
    return rows[0] ?? null;
  });
}

export interface StockCountRow {
  id: string;
  countType: string;
  status: string;
  periodLabel: string | null;
  createdAt: string;
}

/** Every stock count opened against this outlet's sellable location, newest
 *  first — for the owner's count history and to find the currently open one
 *  to keep entering lines against. */
export async function listStockCountsForOutlet(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<StockCountRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      count_type: string;
      status: string;
      period_label: string | null;
      created_at: Date;
    }>(
      `select id, count_type::text as count_type, status::text as status, period_label, created_at
         from stock.stock_counts
        where outlet_id = $1
        order by created_at desc
        limit 50`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      countType: r.count_type,
      status: r.status,
      periodLabel: r.period_label,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

export interface CountLineRow {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  systemQtyBase: string;
  countedQtyBase: string;
  varianceQtyBase: string;
  reason: string | null;
}

/** Lines already entered for one count, so the owner can see what's left to
 *  count and what's already been keyed in. Any actor who can read this
 *  outlet's stock may view it — the count-scoping check happens on the
 *  outlet lookup, same as the header list above. */
export async function listCountLines(
  pool: StockPool,
  actor: StockActor,
  stockCountId: string,
): Promise<CountLineRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      base_unit: string;
      system_qty_base: string;
      counted_qty_base: string;
      variance_qty_base: string;
      reason: string | null;
    }>(
      `select l.id, l.item_id, i.name as item_name, i.base_unit, l.system_qty_base,
              l.counted_qty_base, l.variance_qty_base, l.reason
         from stock.stock_count_lines l
         join stock.items i on i.id = l.item_id
        where l.stock_count_id = $1
        order by i.name`,
      [stockCountId],
    );
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemName: r.item_name,
      baseUnit: r.base_unit,
      systemQtyBase: r.system_qty_base,
      countedQtyBase: r.counted_qty_base,
      varianceQtyBase: r.variance_qty_base,
      reason: r.reason,
    }));
  });
}

export interface WastageRow {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  qtyBase: string;
  reason: string;
  occurredAt: string;
  employeeName: string | null;
  details: string | null;
}

/** Wastage recorded at this outlet, newest first. */
export async function listWastageForOutlet(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<WastageRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      base_unit: string;
      qty_base: string;
      reason: string;
      occurred_at: Date;
      employee_name: string | null;
      details: string | null;
    }>(
      `select w.id, w.item_id, i.name as item_name, i.base_unit, w.qty_base, w.reason, w.occurred_at, e.employee_name, e.command->>'reason' as details
         from stock.wastage_events w
         join stock.items i on i.id = w.item_id
         left join stock.employee_stock_entries e on e.id=w.id
        where w.outlet_id = $1
        order by w.occurred_at desc
        limit 100`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemName: r.item_name,
      baseUnit: r.base_unit,
      qtyBase: r.qty_base,
      reason: r.reason,
      occurredAt: r.occurred_at.toISOString(),
      employeeName: r.employee_name,
      details: r.details,
    }));
  });
}

export interface CloseableOrderRow {
  id: string;
  orderNumber: string;
  totalPaise: number;
  openDiscrepancies: number;
}

/** Orders fully received at this outlet, still open (not yet `closed`) —
 *  `openDiscrepancies` tells the UI whether "Close order" is actually
 *  available yet (`closeStockOrder` refuses while any are open). */
export async function listOrdersAwaitingClose(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<CloseableOrderRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      order_number: string;
      total_paise: string;
      open_discrepancies: string;
    }>(
      `select o.id, o.order_number, o.total_paise,
              coalesce((
                select count(*) from stock.stock_order_discrepancies d
                  join stock.outlet_inwards oi on oi.id = d.outlet_inward_id
                 where oi.stock_order_id = o.id and d.status = 'open'
              ), 0) as open_discrepancies
         from stock.stock_orders o
        where o.outlet_id = $1 and o.status = 'received'
        order by o.updated_at desc
        limit 50`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      totalPaise: Number(r.total_paise),
      openDiscrepancies: Number(r.open_discrepancies),
    }));
  });
}

export interface LocalInwardRow {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  qtyBase: string;
  unitCostPaise: number | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  valuationState: string;
  status: string;
  createdAt: string;
  employeeName: string | null;
  totalPaid: string | null;
  expenseId: string | null;
}

/** For the owner's review screen — every local (non-JKSH) inward this
 *  outlet's staff have recorded, newest first. */
export async function listLocalInwardsForOutlet(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<LocalInwardRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      base_unit: string;
      qty_base: string;
      unit_cost_paise: string | null;
      supplier_name: string | null;
      invoice_number: string | null;
      valuation_state: string;
      status: string;
      created_at: Date;
      employee_name: string | null;
      total_paid: string | null;
      expense_id: string | null;
    }>(
      `select li.id, li.item_id, i.name as item_name, i.base_unit, li.qty_base, li.unit_cost_paise,
              li.supplier_name, li.invoice_number, li.valuation_state::text as valuation_state,
              li.status::text as status, li.created_at, e.employee_name, e.command->>'amount' as total_paid, e.result->>'expenseId' as expense_id
         from stock.local_inwards li
         join stock.items i on i.id = li.item_id
         left join stock.employee_stock_entries e on e.id=li.id
        where li.outlet_id = $1
        order by li.created_at desc
        limit 200`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemName: r.item_name,
      baseUnit: r.base_unit,
      qtyBase: r.qty_base,
      unitCostPaise: r.unit_cost_paise == null ? null : Number(r.unit_cost_paise),
      supplierName: r.supplier_name,
      invoiceNumber: r.invoice_number,
      valuationState: r.valuation_state,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      employeeName: r.employee_name,
      totalPaid: r.total_paid,
      expenseId: r.expense_id,
    }));
  });
}

export interface DiscrepancyRow {
  id: string;
  itemId: string;
  itemName: string;
  baseUnit: string;
  kind: string;
  qtyBase: string;
  status: string;
  resolution: string | null;
  createdAt: string;
}

/** Every short/damaged/excess/rejected line recorded against this outlet's
 *  receiving, for the owner to resolve via `resolveDiscrepancy`. */
export async function listDiscrepanciesForOutlet(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<DiscrepancyRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      base_unit: string;
      kind: string;
      qty_base: string;
      status: string;
      resolution: string | null;
      created_at: Date;
    }>(
      `select d.id, d.item_id, i.name as item_name, i.base_unit, d.kind::text as kind,
              d.qty_base, d.status::text as status, d.resolution::text as resolution, d.created_at
         from stock.stock_order_discrepancies d
         join stock.outlet_inwards oi on oi.id = d.outlet_inward_id
         join stock.items i on i.id = d.item_id
        where oi.outlet_id = $1
        order by d.created_at desc
        limit 200`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemName: r.item_name,
      baseUnit: r.base_unit,
      kind: r.kind,
      qtyBase: r.qty_base,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.created_at.toISOString(),
    }));
  });
}

/** Bounded, newest-first history, always scoped to the requested outlet and RLS. */
export async function listOutletOrders(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
  before?: string,
) {
  ensureStockAllowed(actor, 'stock.order.oversee');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      order_number: string;
      status: string;
      total_paise: string;
      created_at: Date;
    }>(
      `select id, order_number, status::text, total_paise, created_at
      from stock.stock_orders
      where outlet_id = $1 and organization_id = $2
      and ($3::uuid is null or (created_at, id) <
        (select created_at, id from stock.stock_orders where id = $3 and outlet_id = $1 and organization_id = $2))
      order by created_at desc, id desc limit 51`,
      [outletId, actor.organizationId, before ?? null],
    );
    return {
      orders: rows.slice(0, 50).map((r) => ({
        id: r.id,
        orderNumber: r.order_number,
        status: r.status,
        totalPaise: Number(r.total_paise),
        createdAt: r.created_at.toISOString(),
      })),
      next: rows.length > 50 ? (rows[49]?.id ?? null) : null,
    };
  });
}

export interface PendingDelivery {
  id: string;
  orderId: string;
  orderNumber: string;
  dispatchNumber: string;
  franchiseId: string;
  lines: { id: string; name: string; baseUnit: string; remaining: string }[];
}
export async function listPendingDeliveries(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<PendingDelivery[]> {
  ensureStockAllowed(actor, 'stock.inward.operate');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      stock_order_id: string;
      order_number: string;
      dispatch_number: string;
      franchise_id: string;
      line_id: string;
      name: string;
      base_unit: string;
      remaining: string;
    }>(
      `with outstanding as (
      select dl.id, dl.stock_dispatch_id, dl.item_id,
        dl.qty_base - coalesce((select sum(accepted_qty_base + short_qty_base + damaged_qty_base + rejected_qty_base)
          from stock.outlet_inward_lines il where il.stock_dispatch_line_id = dl.id), 0) as remaining
      from stock.stock_dispatch_lines dl
      join stock.stock_dispatches sd on sd.id = dl.stock_dispatch_id
      join stock.stock_orders so on so.id = sd.stock_order_id
      where so.outlet_id = $1 and so.organization_id = $2 and so.status not in ('closed','cancelled')
    ), pending as (
      select d.id from stock.stock_dispatches d join stock.stock_orders o on o.id = d.stock_order_id
      where o.outlet_id = $1 and o.organization_id = $2 and o.status not in ('closed','cancelled')
        and exists (select 1 from outstanding x where x.stock_dispatch_id = d.id and x.remaining > 0)
      order by d.created_at, d.id limit 50
    )
    select d.id, d.stock_order_id, d.dispatch_number, o.order_number, o.franchise_id,
      x.id as line_id, i.name, i.base_unit, x.remaining::text
    from pending p join stock.stock_dispatches d on d.id = p.id
    join stock.stock_orders o on o.id = d.stock_order_id
    join outstanding x on x.stock_dispatch_id = d.id and x.remaining > 0
    join stock.items i on i.id = x.item_id order by d.created_at, d.id, i.name`,
      [outletId, actor.organizationId],
    );
    const grouped = new Map<string, PendingDelivery>();
    for (const r of rows) {
      if (!grouped.has(r.id))
        grouped.set(r.id, {
          id: r.id,
          orderId: r.stock_order_id,
          orderNumber: r.order_number,
          dispatchNumber: r.dispatch_number,
          franchiseId: r.franchise_id,
          lines: [],
        });
      grouped.get(r.id)?.lines.push({
        id: r.line_id,
        name: r.name,
        baseUnit: r.base_unit,
        remaining: r.remaining,
      });
    }
    return [...grouped.values()];
  });
}

export async function listSupplyCatalogForCentral(pool: StockPool, actor: StockActor) {
  ensureStockAllowed(actor, 'stock.master.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      item_id: string;
      gst_inclusive_price_paise: string;
      gst_rate: string;
      order_pack_base: string;
      is_available: boolean;
      delivery_rule_id: string | null;
      hsn_code: string | null;
    }>(
      `select item_id, gst_inclusive_price_paise, gst_rate, order_pack_base, is_available, delivery_rule_id, hsn_code
      from stock.supply_catalog_items s where organization_id = $1
        and exists (select 1 from stock.items i where i.id=s.item_id and i.is_active) order by item_id`,
      [actor.organizationId],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      pricePaise: Number(r.gst_inclusive_price_paise),
      gstRate: r.gst_rate,
      orderPackBase: r.order_pack_base,
      available: r.is_available,
      deliveryRuleId: r.delivery_rule_id,
      hsnCode: r.hsn_code,
    }));
  });
}
