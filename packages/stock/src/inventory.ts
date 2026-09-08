import { withStockActorContext, type StockPool } from '@jksh/db';
import {
  ensureStockAllowed,
  stockContextForActor,
  stockSystemActor,
  type StockActor,
} from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';
import { recordStockAudit } from './audit';

type ItemType =
  | 'raw_material'
  | 'packaged_product'
  | 'packaging'
  | 'consumable'
  | 'finished_good'
  | 'intermediate';
type Dimension = 'mass' | 'volume' | 'count';
type SupplyRule = 'jksh_required' | 'local_purchase' | 'flexible';
type LocationKind =
  | 'sellable'
  | 'quarantine'
  | 'damaged'
  | 'returns'
  | 'in_transit'
  | 'production_input'
  | 'production_output'
  | 'staging';

const WAREHOUSE_DEFAULT_KINDS: LocationKind[] = [
  'sellable',
  'quarantine',
  'damaged',
  'returns',
  'in_transit',
  'production_input',
  'production_output',
  'staging',
];

export interface CreateItemCommand {
  organizationId: string;
  brandId?: string | null | undefined;
  sku: string;
  name: string;
  itemType: ItemType;
  dimension: Dimension;
  baseUnit: string;
  supplyRule?: SupplyRule | undefined;
  isBatchTracked?: boolean | undefined;
  isReturnable?: boolean | undefined;
  shelfLifeDays?: number | null | undefined;
  orderPack?: number | null | undefined;
  gstRate?: string | number | undefined;
  hsnCode?: string | null | undefined;
  purchaseUnit?: string | null | undefined;
}

export async function createItem(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateItemCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.master.manage');
  if (actor.request !== 'system' && actor.organizationId !== cmd.organizationId) {
    throw new StockError('forbidden', 'Cross-organization item creation');
  }
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const dup = await client.query(
      'select 1 from stock.items where organization_id = $1 and sku = $2',
      [cmd.organizationId, cmd.sku],
    );
    if (dup.rowCount) throw new StockError('conflict', `SKU already exists: ${cmd.sku}`);

    const ins = await client.query<{ id: string }>(
      `insert into stock.items
         (organization_id, brand_id, sku, name, item_type, dimension, base_unit,
          supply_rule, is_batch_tracked, is_returnable, shelf_life_days, order_pack,
          gst_rate, hsn_code, purchase_unit, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning id`,
      [
        cmd.organizationId,
        cmd.brandId ?? null,
        cmd.sku,
        cmd.name,
        cmd.itemType,
        cmd.dimension,
        cmd.baseUnit,
        cmd.supplyRule ?? 'flexible',
        cmd.isBatchTracked ?? false,
        cmd.isReturnable ?? false,
        cmd.shelfLifeDays ?? null,
        cmd.orderPack ?? null,
        String(cmd.gstRate ?? 0),
        cmd.hsnCode ?? null,
        cmd.purchaseUnit ?? null,
        actor.accountId ?? null,
      ],
    );
    const id = requireRow(ins, 'item').id;
    await recordStockAudit(client, {
      action: 'item.created',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      subjectType: 'item',
      subjectId: id,
      data: { sku: cmd.sku, itemType: cmd.itemType, supplyRule: cmd.supplyRule ?? 'flexible' },
    });
    return { id };
  });
}

export interface SetUnitConversionCommand {
  itemId: string;
  fromUnit: string;
  toBaseQty: number;
}

export async function setItemUnitConversion(
  pool: StockPool,
  actor: StockActor,
  cmd: SetUnitConversionCommand,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.master.manage');
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const cur = await client.query<{ version: number }>(
      `select version from stock.item_unit_conversions
        where item_id = $1 and lower(from_unit) = lower($2) and is_current`,
      [cmd.itemId, cmd.fromUnit],
    );
    const nextVersion = (cur.rows[0]?.version ?? 0) + 1;
    await client.query(
      `update stock.item_unit_conversions set is_current = false
        where item_id = $1 and lower(from_unit) = lower($2) and is_current`,
      [cmd.itemId, cmd.fromUnit],
    );
    await client.query(
      `insert into stock.item_unit_conversions (item_id, from_unit, to_base_qty, version, created_by)
       values ($1,$2,$3,$4,$5)`,
      [cmd.itemId, cmd.fromUnit, cmd.toBaseQty, nextVersion, actor.accountId ?? null],
    );
  });
}

export interface AddBarcodeCommand {
  organizationId: string;
  itemId: string;
  barcode: string;
  kind?: 'ean' | 'upc' | 'qr' | 'alias' | undefined;
  isPrimary?: boolean | undefined;
}

export async function addItemBarcode(
  pool: StockPool,
  actor: StockActor,
  cmd: AddBarcodeCommand,
): Promise<{ id: string }> {
  ensureStockAllowed(actor, 'stock.master.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const dup = await client.query(
      'select 1 from stock.item_barcodes where organization_id = $1 and barcode = $2',
      [cmd.organizationId, cmd.barcode],
    );
    if (dup.rowCount) throw new StockError('conflict', 'Barcode already registered');
    const ins = await client.query<{ id: string }>(
      `insert into stock.item_barcodes (organization_id, item_id, barcode, kind, is_primary, created_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [
        cmd.organizationId,
        cmd.itemId,
        cmd.barcode,
        cmd.kind ?? 'alias',
        cmd.isPrimary ?? false,
        actor.accountId ?? null,
      ],
    );
    return { id: requireRow(ins, 'barcode').id };
  });
}

export interface CreateWarehouseCommand {
  organizationId: string;
  code: string;
  name: string;
  timezone?: string | undefined;
}

export async function createWarehouse(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateWarehouseCommand,
): Promise<{ id: string; locationIds: Record<string, string> }> {
  ensureStockAllowed(actor, 'stock.config.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const wh = await client.query<{ id: string }>(
      `insert into stock.warehouses (organization_id, code, name, timezone)
       values ($1,$2,$3,$4) returning id`,
      [cmd.organizationId, cmd.code, cmd.name, cmd.timezone ?? 'Asia/Kolkata'],
    );
    const warehouseId = requireRow(wh, 'warehouse').id;
    const locationIds: Record<string, string> = {};
    for (const kind of WAREHOUSE_DEFAULT_KINDS) {
      const loc = await client.query<{ id: string }>(
        `insert into stock.stock_locations
           (organization_id, scope, warehouse_id, kind, name)
         values ($1,'warehouse',$2,$3,$4) returning id`,
        [cmd.organizationId, warehouseId, kind, `${cmd.name} / ${kind}`],
      );
      locationIds[kind] = requireRow(loc, 'location').id;
    }
    await recordStockAudit(client, {
      action: 'warehouse.created',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: cmd.organizationId,
      warehouseId,
      subjectType: 'warehouse',
      subjectId: warehouseId,
      data: { code: cmd.code },
    });
    return { id: warehouseId, locationIds };
  });
}

export interface ConfigureOutletStockCommand {
  outletId: string;
  organizationId: string;
  franchiseId?: string | null | undefined;
  trackingEnabled?: boolean | undefined;
  timezone?: string | undefined;
}

/**
 * Enable Stock tracking for an outlet and create its single sellable location.
 * Enabling on an existing outlet still requires an opening physical count
 * (`opening_count_done` starts false).
 */
export async function configureOutletStock(
  pool: StockPool,
  actor: StockActor,
  cmd: ConfigureOutletStockCommand,
): Promise<{ sellableLocationId: string }> {
  // Outlet Stock onboarding (which locations exist, tracking on/off) is a
  // Central operation - it must not trust a caller-supplied franchiseId.
  if (actor.request !== 'system' && actor.role !== 'central_admin') {
    throw new StockError('forbidden', 'Only Central configures outlet Stock');
  }
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    await client.query(
      `insert into stock.outlet_stock_settings
         (outlet_id, organization_id, franchise_id, tracking_enabled, timezone)
       values ($1,$2,$3,$4,$5)
       on conflict (outlet_id) do update set
         tracking_enabled = excluded.tracking_enabled,
         timezone = excluded.timezone,
         updated_at = now()`,
      [
        cmd.outletId,
        cmd.organizationId,
        cmd.franchiseId ?? null,
        cmd.trackingEnabled ?? true,
        cmd.timezone ?? 'Asia/Kolkata',
      ],
    );
    const loc = await client.query<{ id: string }>(
      `insert into stock.stock_locations
         (organization_id, scope, outlet_id, franchise_id, kind, name)
       values ($1,'outlet',$2,$3,'sellable',$4)
       on conflict (outlet_id, kind) where scope = 'outlet'
       do update set is_active = true
       returning id`,
      [
        cmd.organizationId,
        cmd.outletId,
        cmd.franchiseId ?? null,
        `Outlet ${cmd.outletId} / sellable`,
      ],
    );
    return { sellableLocationId: requireRow(loc, 'sellable location').id };
  });
}

export interface CreateBatchCommand {
  organizationId: string;
  itemId: string;
  batchCode: string;
  manufactureDate?: string | null | undefined;
  expiryDate?: string | null | undefined;
  origin: 'received' | 'produced' | 'opening' | 'transfer' | 'local_inward';
  supplierId?: string | null | undefined;
  parentBatchId?: string | null | undefined;
}

export async function createBatch(
  pool: StockPool,
  actor: StockActor,
  cmd: CreateBatchCommand,
): Promise<{ id: string }> {
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const existing = await client.query<{ id: string }>(
      'select id from stock.batches where item_id = $1 and batch_code = $2',
      [cmd.itemId, cmd.batchCode],
    );
    if (existing.rows[0]) return { id: existing.rows[0].id };
    const ins = await client.query<{ id: string }>(
      `insert into stock.batches
         (organization_id, item_id, batch_code, manufacture_date, expiry_date, origin,
          supplier_id, parent_batch_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        cmd.organizationId,
        cmd.itemId,
        cmd.batchCode,
        cmd.manufactureDate ?? null,
        cmd.expiryDate ?? null,
        cmd.origin,
        cmd.supplierId ?? null,
        cmd.parentBatchId ?? null,
        actor.accountId ?? null,
      ],
    );
    return { id: requireRow(ins, 'batch').id };
  });
}

// ---- Reads --------------------------------------------------------------

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  itemType: ItemType;
  baseUnit: string;
  supplyRule: SupplyRule;
  isBatchTracked: boolean;
}

export async function listItems(
  pool: StockPool,
  actor: StockActor,
  opts: { organizationId: string; search?: string; limit?: number } = { organizationId: '' },
): Promise<ItemRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  const organizationId = opts.organizationId || actor.organizationId;
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      sku: string;
      name: string;
      item_type: ItemType;
      base_unit: string;
      supply_rule: SupplyRule;
      is_batch_tracked: boolean;
    }>(
      `select id, sku, name, item_type, base_unit, supply_rule, is_batch_tracked
         from stock.items
        where organization_id = $1 and is_active
          and ($2::text is null or name ilike '%' || $2 || '%' or sku ilike '%' || $2 || '%')
        order by name
        limit $3`,
      [organizationId, opts.search ?? null, Math.min(opts.limit ?? 100, 500)],
    );
    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      itemType: r.item_type,
      baseUnit: r.base_unit,
      supplyRule: r.supply_rule,
      isBatchTracked: r.is_batch_tracked,
    }));
  });
}

export interface BalanceRow {
  stockLocationId: string;
  locationName: string;
  itemId: string;
  itemName: string;
  batchId: string | null;
  batchCode: string | null;
  expiryDate: string | null;
  onHand: string;
  allocated: string;
  usable: string;
}

export async function getItemBalances(
  pool: StockPool,
  actor: StockActor,
  itemId: string,
): Promise<BalanceRow[]> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      stock_location_id: string;
      location_name: string;
      item_id: string;
      item_name: string;
      batch_id: string | null;
      batch_code: string | null;
      expiry_date: string | null;
      on_hand: string;
      allocated: string;
    }>(
      `select b.stock_location_id, l.name as location_name, b.item_id, i.name as item_name,
              b.batch_id, bt.batch_code, bt.expiry_date::text as expiry_date,
              b.on_hand, b.allocated
         from stock.stock_balances b
         join stock.stock_locations l on l.id = b.stock_location_id
         join stock.items i on i.id = b.item_id
         left join stock.batches bt on bt.id = b.batch_id
        where b.item_id = $1
        order by l.name, bt.expiry_date nulls last`,
      [itemId],
    );
    return rows.map((r) => ({
      stockLocationId: r.stock_location_id,
      locationName: r.location_name,
      itemId: r.item_id,
      itemName: r.item_name,
      batchId: r.batch_id,
      batchCode: r.batch_code,
      expiryDate: r.expiry_date,
      onHand: r.on_hand,
      allocated: r.allocated,
      usable: (Number(r.on_hand) - Number(r.allocated)).toFixed(6),
    }));
  });
}

export { stockSystemActor };
