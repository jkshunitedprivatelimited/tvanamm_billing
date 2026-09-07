import { withStockActorContext, type StockPool } from '@jksh/db';
import {
  assertOutletInFranchise,
  ensureStockAllowed,
  stockContextForActor,
  type StockActor,
} from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';

export interface UpsertDeliveryRuleCommand {
  organizationId: string;
  id?: string;
  name: string;
  kind: 'flat' | 'per_outlet' | 'free_over_threshold' | 'free';
  amountPaise?: number;
  freeOverPaise?: number | null;
}

export async function upsertDeliveryRule(
  pool: StockPool,
  actor: StockActor,
  cmd: UpsertDeliveryRuleCommand,
): Promise<{ id: string; version: number }> {
  ensureStockAllowed(actor, 'stock.config.manage');
  if (cmd.kind === 'free_over_threshold' && cmd.freeOverPaise == null) {
    throw new StockError('validation', 'free_over_threshold needs freeOverPaise');
  }
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    if (cmd.id) {
      const upd = await client.query<{ id: string; version: number }>(
        `update stock.delivery_charge_rules
            set name = $2, kind = $3, amount_paise = $4, free_over_paise = $5,
                version = version + 1, updated_at = now()
          where id = $1 returning id, version`,
        [cmd.id, cmd.name, cmd.kind, cmd.amountPaise ?? 0, cmd.freeOverPaise ?? null],
      );
      const row = upd.rows[0];
      if (!row) throw new StockError('not_found', 'Delivery rule not found');
      return row;
    }
    const ins = await client.query<{ id: string; version: number }>(
      `insert into stock.delivery_charge_rules
         (organization_id, name, kind, amount_paise, free_over_paise)
       values ($1,$2,$3,$4,$5) returning id, version`,
      [cmd.organizationId, cmd.name, cmd.kind, cmd.amountPaise ?? 0, cmd.freeOverPaise ?? null],
    );
    return requireRow(ins, 'delivery rule');
  });
}

export interface PublishCatalogItemCommand {
  organizationId: string;
  brandId?: string | null;
  itemId: string;
  gstInclusivePricePaise: number;
  gstRate?: string | number;
  hsnCode?: string | null;
  orderPackBase?: string;
  deliveryRuleId?: string | null;
  isAvailable?: boolean;
}

export async function publishCatalogItem(
  pool: StockPool,
  actor: StockActor,
  cmd: PublishCatalogItemCommand,
): Promise<{ id: string; version: number }> {
  ensureStockAllowed(actor, 'stock.config.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string; version: number }>(
      `insert into stock.supply_catalog_items
         (organization_id, brand_id, item_id, gst_inclusive_price_paise, gst_rate, hsn_code,
          order_pack_base, delivery_rule_id, is_available, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (organization_id, item_id) do update set
         gst_inclusive_price_paise = excluded.gst_inclusive_price_paise,
         gst_rate = excluded.gst_rate,
         hsn_code = excluded.hsn_code,
         order_pack_base = excluded.order_pack_base,
         delivery_rule_id = excluded.delivery_rule_id,
         is_available = excluded.is_available,
         version = stock.supply_catalog_items.version + 1,
         updated_at = now()
       returning id, version`,
      [
        cmd.organizationId,
        cmd.brandId ?? null,
        cmd.itemId,
        cmd.gstInclusivePricePaise,
        String(cmd.gstRate ?? 0),
        cmd.hsnCode ?? null,
        cmd.orderPackBase ?? '1',
        cmd.deliveryRuleId ?? null,
        cmd.isAvailable ?? true,
        actor.accountId ?? null,
      ],
    );
    return requireRow(ins, 'catalog item');
  });
}

export interface CatalogEntry {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  gstInclusivePricePaise: number;
  gstRate: string;
  hsnCode: string | null;
  orderPackBase: string;
  isAvailable: boolean;
  version: number;
}

/** Catalog visible to an outlet: available items minus per-outlet blocks. */
export async function getSupplyCatalogForOutlet(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<CatalogEntry[]> {
  ensureStockAllowed(actor, 'stock.order.create');
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      item_id: string;
      item_name: string;
      sku: string;
      gst_inclusive_price_paise: string;
      gst_rate: string;
      hsn_code: string | null;
      order_pack_base: string;
      is_available: boolean;
      version: number;
    }>(
      `select c.id, c.item_id, i.name as item_name, i.sku,
              c.gst_inclusive_price_paise, c.gst_rate, c.hsn_code, c.order_pack_base,
              c.is_available, c.version
         from stock.supply_catalog_items c
         join stock.items i on i.id = c.item_id
        where c.is_available
          and not exists (
            select 1 from stock.supply_catalog_outlet_blocks b
             where b.supply_catalog_item_id = c.id and b.outlet_id = $1)
        order by i.name`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemName: r.item_name,
      sku: r.sku,
      gstInclusivePricePaise: Number(r.gst_inclusive_price_paise),
      gstRate: r.gst_rate,
      hsnCode: r.hsn_code,
      orderPackBase: r.order_pack_base,
      isAvailable: r.is_available,
      version: r.version,
    }));
  });
}
