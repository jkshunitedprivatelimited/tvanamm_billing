import { withStockActorContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';

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
        where organization_id = $1 order by name`,
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
        where organization_id = $1 order by name`,
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
      billing_menu_item_id: string | null;
      billing_addon_id: string | null;
    }>(
      `select id, name, kind::text as kind, status::text as status, current_version,
              billing_menu_item_id, billing_addon_id
         from stock.recipes where organization_id = $1 order by name`,
      [actor.organizationId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      status: r.status,
      currentVersion: r.current_version,
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
        where r.organization_id = $1 order by r.created_at desc limit 100`,
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
