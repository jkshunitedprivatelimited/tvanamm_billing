import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { requireRow } from './rows';

// ---- Reorder suggestion math (pure) -------------------------------

export interface SuggestionInputs {
  trailingDailyConsumptionBase: number;
  leadTimeDays: number;
  safetyDays: number;
  usableStockBase: number;
  confirmedInboundBase: number;
  backorderBase: number;
  orderPackBase: number;
}

/**
 * suggested = forecast demand through lead time + safety days
 *           - usable stock - confirmed inbound + backorder,
 * rounded up to the order pack, never negative. No manual min/max, never
 * auto-orders (`franchise-owner-stock-portal.md` "Reorder Suggestions").
 */
export function suggestReorderQty(input: SuggestionInputs): number {
  const demand = input.trailingDailyConsumptionBase * (input.leadTimeDays + input.safetyDays);
  const raw = demand - input.usableStockBase - input.confirmedInboundBase + input.backorderBase;
  if (raw <= 0) return 0;
  const pack = input.orderPackBase > 0 ? input.orderPackBase : 1;
  return Math.ceil(raw / pack) * pack;
}

// ---- Daily consumption rollups ---------------------------------

/**
 * Rebuild daily consumption rollups for an organization from
 * sale_consumption_lines. Dashboards and suggestions read the rollups, never
 * the full ledger.
 */
export async function rebuildDailyConsumptionRollups(
  pool: StockPool,
  organizationId: string,
): Promise<{ rows: number }> {
  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    await client.query('delete from stock.daily_consumption_rollups where organization_id = $1', [
      organizationId,
    ]);
    const res = await client.query(
      `insert into stock.daily_consumption_rollups
         (organization_id, outlet_id, item_id, business_date, qty_consumed_base, sale_lines)
       select sc.organization_id, sc.outlet_id, scl.item_id, sc.business_date,
              sum(scl.qty_base), count(*)
         from stock.sale_consumptions sc
         join stock.sale_consumption_lines scl on scl.sale_consumption_id = sc.id
        where sc.organization_id = $1 and sc.outlet_id is not null and sc.business_date is not null
          and sc.event_type = 'SaleCompleted'
        group by sc.organization_id, sc.outlet_id, scl.item_id, sc.business_date`,
      [organizationId],
    );
    return { rows: res.rowCount ?? 0 };
  });
}

// ---- Suggestion generation -----------------------------------

export interface GenerateSuggestionsCommand {
  organizationId: string;
  outletId: string;
  trailingDays?: number;
  leadTimeDays?: number;
  safetyDays?: number;
}

export async function generateReorderSuggestions(
  pool: StockPool,
  actor: StockActor,
  cmd: GenerateSuggestionsCommand,
): Promise<{ created: number }> {
  ensureStockAllowed(actor, 'stock.inventory.read');
  const trailingDays = cmd.trailingDays ?? 14;
  const leadTimeDays = cmd.leadTimeDays ?? 3;
  const safetyDays = cmd.safetyDays ?? 2;

  return withStockActorContext(pool, stockSystemContext(), async (client) => {
    const loc = await client.query<{ id: string }>(
      `select id from stock.stock_locations where outlet_id = $1 and scope = 'outlet' and kind = 'sellable'`,
      [cmd.outletId],
    );
    const locationId = loc.rows[0]?.id;
    if (!locationId) throw new StockError('conflict', 'Outlet stock tracking is not configured');

    const rows = await client.query<{
      item_id: string;
      trailing: string;
      usable: string;
      inbound: string;
      backorder: string;
      order_pack: string | null;
    }>(
      `with consumption as (
         select item_id, coalesce(sum(qty_consumed_base), 0) as consumed
           from stock.daily_consumption_rollups
          where outlet_id = $1 and business_date >= (current_date - $3::int)
          group by item_id
       ),
       usable as (
         select item_id, sum(on_hand - allocated) as usable
           from stock.stock_balances where stock_location_id = $2
           group by item_id
       ),
       inbound as (
         select l.item_id, coalesce(sum(l.dispatched_qty_base - l.received_qty_base), 0) as inbound
           from stock.stock_order_lines l
           join stock.stock_orders o on o.id = l.stock_order_id
          where o.outlet_id = $1 and o.status in ('dispatched','partially_dispatched','partially_received')
          group by l.item_id
       ),
       backorder as (
         select l.item_id, coalesce(sum(l.qty_base - l.dispatched_qty_base), 0) as backorder
           from stock.stock_order_lines l
           join stock.stock_orders o on o.id = l.stock_order_id
          where o.outlet_id = $1 and o.status in ('partially_dispatched','allocated','approved','paid')
          group by l.item_id
       )
       select i.id as item_id,
              coalesce(c.consumed, 0) / $3::numeric as trailing,
              coalesce(u.usable, 0) as usable,
              coalesce(nb.inbound, 0) as inbound,
              coalesce(bo.backorder, 0) as backorder,
              i.order_pack as order_pack
         from stock.items i
         left join consumption c on c.item_id = i.id
         left join usable u on u.item_id = i.id
         left join inbound nb on nb.item_id = i.id
         left join backorder bo on bo.item_id = i.id
        where i.organization_id = $4 and i.is_active
          and (c.consumed is not null or u.usable is not null)`,
      [cmd.outletId, locationId, trailingDays, cmd.organizationId],
    );

    let created = 0;
    for (const r of rows.rows) {
      const inputs: SuggestionInputs = {
        trailingDailyConsumptionBase: Number(r.trailing),
        leadTimeDays,
        safetyDays,
        usableStockBase: Number(r.usable),
        confirmedInboundBase: Number(r.inbound),
        backorderBase: Number(r.backorder),
        orderPackBase: Number(r.order_pack ?? '1'),
      };
      const suggested = suggestReorderQty(inputs);
      if (suggested <= 0) {
        await client.query(
          `delete from stock.reorder_suggestions
            where outlet_id = $1 and item_id = $2 and status = 'open'`,
          [cmd.outletId, r.item_id],
        );
        continue;
      }
      await client.query(
        `insert into stock.reorder_suggestions
           (organization_id, outlet_id, item_id, suggested_qty_base, inputs, status)
         values ($1,$2,$3,$4,$5,'open')
         on conflict (outlet_id, item_id) do update set
           suggested_qty_base = excluded.suggested_qty_base,
           inputs = excluded.inputs,
           status = case when stock.reorder_suggestions.status = 'dismissed'
                          and (stock.reorder_suggestions.dismissed_until is null
                               or stock.reorder_suggestions.dismissed_until > current_date)
                         then 'dismissed'::stock.suggestion_status else 'open'::stock.suggestion_status end,
           updated_at = now()`,
        [cmd.organizationId, cmd.outletId, r.item_id, suggested.toFixed(6), JSON.stringify(inputs)],
      );
      created += 1;
    }
    return { created };
  });
}

export async function dismissSuggestion(
  pool: StockPool,
  actor: StockActor,
  suggestionId: string,
  dismissedUntil: string | null,
): Promise<void> {
  ensureStockAllowed(actor, 'stock.order.create');
  await withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const r = await client.query(
      `update stock.reorder_suggestions
          set status = 'dismissed', dismissed_until = $2, updated_at = now()
        where id = $1`,
      [suggestionId, dismissedUntil],
    );
    if (!r.rowCount) throw new StockError('not_found', 'Suggestion not found');
  });
}

// ---- Explainable anomaly flags ------------------------------

export interface FlagAnomalyCommand {
  organizationId: string;
  outletId?: string | null;
  warehouseId?: string | null;
  subjectType: string;
  subjectId?: string | null;
  kind: string;
  explanation: Record<string, unknown>;
}

export async function flagAnomaly(
  pool: StockPool,
  actor: StockActor,
  cmd: FlagAnomalyCommand,
): Promise<{ id: string }> {
  if (actor.request !== 'system' && actor.role !== 'central_admin') {
    throw new StockError('forbidden', 'Only Central records anomaly flags');
  }
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const ins = await client.query<{ id: string }>(
      `insert into stock.anomaly_flags
         (organization_id, outlet_id, warehouse_id, subject_type, subject_id, kind, explanation)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        cmd.organizationId,
        cmd.outletId ?? null,
        cmd.warehouseId ?? null,
        cmd.subjectType,
        cmd.subjectId ?? null,
        cmd.kind,
        JSON.stringify(cmd.explanation),
      ],
    );
    return { id: requireRow(ins, 'anomaly flag').id };
  });
}

// ---- Combined Owner dashboard --------------------------------

export interface OwnerDashboard {
  outletId: string;
  stockValuePaise: number;
  negativeBalanceItems: number;
  expiryWarnings: number;
  pendingLocalInwardReviews: number;
  openSuggestions: number;
  openDiscrepancies: number;
  openRecalls: number;
  openNegativeExceptions: number;
}

/** Reads maintained projections only; no full-ledger summation. */
export async function getOwnerDashboard(
  pool: StockPool,
  actor: StockActor,
  outletId: string,
): Promise<OwnerDashboard> {
  ensureStockAllowed(actor, 'stock.report.read');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const loc = await client.query<{ id: string }>(
      `select id from stock.stock_locations where outlet_id = $1 and scope = 'outlet' and kind = 'sellable'`,
      [outletId],
    );
    const locationId = loc.rows[0]?.id ?? null;

    const value = await client.query<{ v: string }>(
      `select coalesce(sum(b.on_hand * v.avg_cost_paise), 0) as v
         from stock.stock_balances b
         join stock.item_valuation v
           on v.item_id = b.item_id and v.organization_id = b.organization_id
        where b.stock_location_id = $1 and b.on_hand > 0`,
      [locationId],
    );
    const negatives = await client.query<{ n: string }>(
      `select count(*) as n from stock.stock_balances where stock_location_id = $1 and on_hand < 0`,
      [locationId],
    );
    const expiry = await client.query<{ n: string }>(
      `select count(distinct b.batch_id) as n
         from stock.stock_balances b
         join stock.batches bt on bt.id = b.batch_id
        where b.stock_location_id = $1 and b.on_hand > 0
          and bt.expiry_date is not null and bt.expiry_date <= (current_date + 14)`,
      [locationId],
    );
    const localReviews = await client.query<{ n: string }>(
      `select count(*) as n from stock.local_inwards where outlet_id = $1 and status = 'pending_review'`,
      [outletId],
    );
    const suggestions = await client.query<{ n: string }>(
      `select count(*) as n from stock.reorder_suggestions where outlet_id = $1 and status = 'open'`,
      [outletId],
    );
    const discrepancies = await client.query<{ n: string }>(
      `select count(*) as n from stock.stock_order_discrepancies d
         join stock.outlet_inwards i on i.id = d.outlet_inward_id
        where i.outlet_id = $1 and d.status = 'open'`,
      [outletId],
    );
    const recalls = await client.query<{ n: string }>(
      `select count(distinct rl.recall_id) as n from stock.recall_locations rl
         join stock.recalls r on r.id = rl.recall_id
        where rl.outlet_id = $1 and r.status <> 'closed'`,
      [outletId],
    );
    const negExceptions = await client.query<{ n: string }>(
      `select count(*) as n from stock.negative_stock_exceptions
        where outlet_id = $1 and resolved_at is null`,
      [outletId],
    );

    return {
      outletId,
      stockValuePaise: Math.round(Number(value.rows[0]?.v ?? '0')),
      negativeBalanceItems: Number(negatives.rows[0]?.n ?? '0'),
      expiryWarnings: Number(expiry.rows[0]?.n ?? '0'),
      pendingLocalInwardReviews: Number(localReviews.rows[0]?.n ?? '0'),
      openSuggestions: Number(suggestions.rows[0]?.n ?? '0'),
      openDiscrepancies: Number(discrepancies.rows[0]?.n ?? '0'),
      openRecalls: Number(recalls.rows[0]?.n ?? '0'),
      openNegativeExceptions: Number(negExceptions.rows[0]?.n ?? '0'),
    };
  });
}

export interface CentralOversight {
  organizationId: string;
  stockValuePaise: number;
  openNegativeExceptions: number;
  openAnomalyFlags: number;
  wastageEventsLast30: number;
  outletsTracked: number;
  openRecalls: number;
}

export async function getCentralOversight(
  pool: StockPool,
  actor: StockActor,
  organizationId: string,
): Promise<CentralOversight> {
  if (actor.request !== 'system' && !['central_admin', 'accountant'].includes(actor.role)) {
    throw new StockError('forbidden', 'Central oversight is Central / Accountant only');
  }
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const value = await client.query<{ v: string }>(
      `select coalesce(sum(b.on_hand * v.avg_cost_paise), 0) as v
         from stock.stock_balances b
         join stock.item_valuation v
           on v.item_id = b.item_id and v.organization_id = b.organization_id
        where b.organization_id = $1 and b.on_hand > 0`,
      [organizationId],
    );
    const negs = await client.query<{ n: string }>(
      `select count(*) as n from stock.negative_stock_exceptions e
         join stock.sale_consumptions s on s.id = e.sale_consumption_id
        where s.organization_id = $1 and e.resolved_at is null`,
      [organizationId],
    );
    const flags = await client.query<{ n: string }>(
      `select count(*) as n from stock.anomaly_flags where organization_id = $1 and status = 'open'`,
      [organizationId],
    );
    const wastage = await client.query<{ n: string }>(
      `select count(*) as n from stock.wastage_events
        where organization_id = $1 and occurred_at >= now() - interval '30 days'`,
      [organizationId],
    );
    const outlets = await client.query<{ n: string }>(
      `select count(*) as n from stock.outlet_stock_settings
        where organization_id = $1 and tracking_enabled`,
      [organizationId],
    );
    const recalls = await client.query<{ n: string }>(
      `select count(*) as n from stock.recalls where organization_id = $1 and status <> 'closed'`,
      [organizationId],
    );
    return {
      organizationId,
      stockValuePaise: Math.round(Number(value.rows[0]?.v ?? '0')),
      openNegativeExceptions: Number(negs.rows[0]?.n ?? '0'),
      openAnomalyFlags: Number(flags.rows[0]?.n ?? '0'),
      wastageEventsLast30: Number(wastage.rows[0]?.n ?? '0'),
      outletsTracked: Number(outlets.rows[0]?.n ?? '0'),
      openRecalls: Number(recalls.rows[0]?.n ?? '0'),
    };
  });
}
