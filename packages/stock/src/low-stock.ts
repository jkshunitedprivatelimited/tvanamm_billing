import { randomUUID } from 'node:crypto';
import {
  withStockActorContext,
  stockSystemContext,
  type StockPool,
  type StockPoolClient,
} from '@jksh/db';
import { lowStockEventSchema, saveLowStockRuleSchema, type LowStockEvent } from '@jksh/contracts';
import { assertOutletInFranchise, stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { toBaseQuantity } from './units';
import { recordStockAudit } from './audit';

function ownerOrCentral(actor: StockActor) {
  if (
    actor.request !== 'system' &&
    actor.role !== 'franchise_owner' &&
    actor.role !== 'central_admin'
  ) {
    throw new StockError(
      'forbidden',
      'Only franchise owners and central admin can manage stock alerts',
    );
  }
}

// Use sellable stock only, net of reservations. Keep negative positions so
// shortages cannot disappear by clamping each batch to zero. Expiry follows
// the outlet's business date, including batches that expire today.
const USABLE = `select coalesce(sum(b.on_hand - b.allocated), 0)::text as quantity
  from stock.stock_balances b
  join stock.stock_locations l on l.id = b.stock_location_id
  left join stock.batches bt on bt.id = b.batch_id
  where b.outlet_id = s.outlet_id and b.item_id = i.id
    and l.is_active and l.kind = 'sellable'
    and (bt.id is null or (bt.status = 'active' and bt.recall_id is null
      and (bt.expiry_date is null or bt.expiry_date >= (now() at time zone s.timezone)::date)))`;

export interface LowStockItem {
  itemId: string;
  name: string;
  sku: string;
  baseUnit: string;
  threshold: string | null;
  enabled: boolean;
  quantity: string;
  checkedAt: string | null;
  low: boolean;
  trackingStarted: boolean;
}

export async function listLowStockItems(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<LowStockItem[]> {
  ownerOrCentral(actor);
  await assertOutletInFranchise(pool, actor, outletId);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      item_id: string;
      name: string;
      sku: string;
      base_unit: string;
      threshold_base: string | null;
      enabled: boolean | null;
      tracking_enabled: boolean;
      tracking_started: boolean;
      quantity: string;
      checked_at: Date | null;
    }>(
      `select i.id as item_id, i.name, i.sku, i.base_unit, r.threshold_base, r.enabled,
        q.quantity, r.checked_at, s.tracking_enabled, exists (select 1 from stock.item_tracking_starts t join stock.stock_locations loc on loc.id=t.stock_location_id where loc.outlet_id=s.outlet_id and t.item_id=i.id) as tracking_started
      from stock.outlet_stock_settings s
      join stock.items i on i.organization_id = s.organization_id and i.is_active
      left join stock.low_stock_rules r on r.outlet_id = s.outlet_id and r.item_id = i.id
      cross join lateral (${USABLE}) q
      where s.outlet_id = $1 and s.organization_id = $2 order by i.name, i.id`,
      [outletId, actor.organizationId],
    );
    return rows.map((r) => ({
      trackingStarted: r.tracking_started,
      itemId: r.item_id,
      name: r.name,
      sku: r.sku,
      baseUnit: r.base_unit,
      threshold: r.threshold_base,
      enabled: r.enabled ?? false,
      quantity: r.quantity,
      checkedAt: r.checked_at?.toISOString() ?? null,
      low:
        r.tracking_started &&
        r.tracking_enabled &&
        !!r.enabled &&
        r.threshold_base !== null &&
        Number(r.quantity) <= Number(r.threshold_base),
    }));
  });
}

export async function saveLowStockRule(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
  raw: unknown,
): Promise<void> {
  ownerOrCentral(actor);
  await assertOutletInFranchise(pool, actor, outletId);
  const parsed = saveLowStockRuleSchema.safeParse(raw);
  if (!parsed.success) throw new StockError('validation', 'Enter a valid item, quantity and unit');
  const cmd = parsed.data;
  // Scope is checked again in the write transaction, including organization.
  await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const settings = await client.query<{ franchise_id: string | null }>(
      `select franchise_id from stock.outlet_stock_settings where outlet_id = $1 and organization_id = $2
        and ($3::boolean or franchise_id = $4::uuid) for share`,
      [
        outletId,
        actor.organizationId,
        actor.role === 'central_admin' || actor.request === 'system',
        actor.franchiseId ?? null,
      ],
    );
    const setting = settings.rows[0];
    if (!setting) throw new StockError('forbidden', 'Outlet is not in your workspace');
    const item = await client.query(
      'select id from stock.items where id = $1 and organization_id = $2 and is_active',
      [cmd.itemId, actor.organizationId],
    );
    if (!item.rowCount) throw new StockError('not_found', 'Stock item not found');
    const threshold = await toBaseQuantity(client, cmd.itemId, cmd.unit, cmd.quantity);
    if (Number(threshold) >= 1e14 || (Number(cmd.quantity) > 0 && Number(threshold) === 0))
      throw new StockError('validation', 'Threshold is outside the supported range');
    const { rows } = await client.query<{ id: string }>(
      `insert into stock.low_stock_rules
      (organization_id, franchise_id, outlet_id, item_id, threshold_base, enabled)
      values ($1,$2,$3,$4,$5,$6) on conflict (outlet_id, item_id) do update set
      threshold_base = excluded.threshold_base, enabled = excluded.enabled, updated_at = now(), checked_at = null returning id`,
      [actor.organizationId, setting.franchise_id, outletId, cmd.itemId, threshold, cmd.enabled],
    );
    const id = rows[0]?.id;
    if (!id) throw new StockError('conflict', 'Could not save alert limit');
    await evaluateRule(client, id);
    await recordStockAudit(client, {
      action: 'low_stock.limit_updated',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: actor.organizationId,
      franchiseId: setting.franchise_id,
      outletId,
      subjectType: 'low_stock_rule',
      subjectId: id,
      data: { itemId: cmd.itemId, threshold, enabled: cmd.enabled },
    });
  });
}

async function evaluateRule(client: StockPoolClient, id: string): Promise<void> {
  // Lock before reading the balance so concurrent evaluators cannot open two
  // episodes or overwrite a newer observation with an older one.
  await client.query('select id from stock.low_stock_rules where id = $1 for update', [id]);
  const { rows } = await client.query<{
    organization_id: string;
    franchise_id: string | null;
    outlet_id: string;
    item_id: string;
    name: string;
    base_unit: string;
    threshold_base: string;
    episode_id: string | null;
    quantity: string;
    is_low: boolean;
  }>(
    `select r.*, i.name, i.base_unit, q.quantity,
      (r.enabled and i.is_active and s.tracking_enabled and exists (select 1 from stock.item_tracking_starts t join stock.stock_locations loc on loc.id=t.stock_location_id where loc.outlet_id=s.outlet_id and t.item_id=i.id) and q.quantity::numeric <= r.threshold_base) as is_low
    from stock.low_stock_rules r join stock.items i on i.id = r.item_id
    join stock.outlet_stock_settings s on s.outlet_id = r.outlet_id
    cross join lateral (${USABLE}) q where r.id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return;
  let episode = r.episode_id;
  if (r.is_low !== (episode !== null)) {
    episode ??= randomUUID();
    const payload: LowStockEvent = {
      episodeId: episode,
      organizationId: r.organization_id,
      franchiseId: r.franchise_id,
      outletId: r.outlet_id,
      itemId: r.item_id,
      itemName: r.name,
      baseUnit: r.base_unit,
      quantity: r.quantity,
      threshold: r.threshold_base,
      state: r.is_low ? 'low' : 'resolved',
    };
    await client.query('insert into stock.low_stock_events(rule_id, payload) values ($1,$2)', [
      id,
      JSON.stringify(payload),
    ]);
    if (!r.is_low) episode = null;
  }
  await client.query(
    'update stock.low_stock_rules set episode_id = $2, last_quantity = $3, checked_at = now() where id = $1',
    [id, episode, r.quantity],
  );
}

/** Bounded, oldest-first scan also detects expiry, recall, and reservation
 * changes without adding notification work to the sale transaction. */
export async function scanLowStockRules(pool: StockPool, limit = 500): Promise<number> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from stock.low_stock_rules
      where enabled or episode_id is not null order by checked_at nulls first, id
      limit $1 for update skip locked`,
      [Math.min(Math.max(limit, 1), 2000)],
    );
    for (const r of rows) await evaluateRule(client, r.id);
    return rows.length;
  });
}

/** Idempotent receiver is mandatory: a crash after remote commit but before
 * local acknowledgement will replay the event. Keep per-rule ordering when
 * one recipient database request fails; other rules can still be delivered. */
export async function deliverLowStockEvents(
  pool: StockPool,
  receive: (event: LowStockEvent) => Promise<void>,
  limit = 100,
) {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const lock = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_xact_lock(hashtextextended('low-stock-delivery', 0)) as acquired",
    );
    if (!lock.rows[0]?.acquired) return { delivered: 0, failed: 0 };
    const { rows } = await client.query<{ id: string; rule_id: string; payload: unknown }>(
      'select id, rule_id, payload from stock.low_stock_events where delivered_at is null order by id limit $1',
      [Math.min(Math.max(limit, 1), 500)],
    );
    const failedRules = new Set<string>();
    let delivered = 0;
    for (const r of rows) {
      if (failedRules.has(r.rule_id)) continue;
      try {
        await receive(lowStockEventSchema.parse(r.payload));
      } catch {
        failedRules.add(r.rule_id);
        continue;
      }
      await client.query('update stock.low_stock_events set delivered_at = now() where id = $1', [
        r.id,
      ]);
      delivered++;
    }
    return { delivered, failed: failedRules.size };
  });
}

export async function listCentralLowStockAlerts(pool: StockPool, actor: StockActor) {
  if (actor.role !== 'central_admin') throw new StockError('forbidden', 'Central admin only');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      outlet_id: string;
      item_id: string;
      name: string;
      base_unit: string;
      threshold_base: string;
      last_quantity: string;
      checked_at: Date;
    }>(
      `select r.outlet_id, r.item_id, i.name, i.base_unit, r.threshold_base, r.last_quantity, r.checked_at
      from stock.low_stock_rules r join stock.items i on i.id = r.item_id
      where r.organization_id = $1 and r.episode_id is not null and r.enabled and i.is_active
        and exists (select 1 from stock.outlet_stock_settings s where s.outlet_id=r.outlet_id and s.tracking_enabled)
      order by r.last_quantity / nullif(r.threshold_base, 0) nulls first, r.checked_at desc limit 100`,
      [actor.organizationId],
    );
    return rows.map((r) => ({
      outletId: r.outlet_id,
      itemId: r.item_id,
      name: r.name,
      baseUnit: r.base_unit,
      threshold: r.threshold_base,
      quantity: r.last_quantity,
      checkedAt: r.checked_at.toISOString(),
    }));
  });
}
