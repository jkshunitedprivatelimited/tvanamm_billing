import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { IdentityError } from './errors';
import { businessDateString } from './membership';

export type ReportRangeKind = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface ReportRange {
  kind: ReportRangeKind;
  from?: string; // YYYY-MM-DD, required when kind = 'custom'
  to?: string;
}

/** Resolves a shortcut label into a concrete inclusive [from, to] range using
 *  one representative outlet timezone (`billing-reporting.md` "Custom dates
 *  use each outlet's business timezone" - true per-outlet boundary
 *  normalization across a multi-timezone combined report is deferred; every
 *  outlet in this system defaults to Asia/Kolkata today). */
export function resolveDateRange(
  range: ReportRange,
  timezone = 'Asia/Kolkata',
  now = new Date(),
): { from: string; to: string } {
  const today = businessDateString(now, timezone);
  switch (range.kind) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = businessDateString(new Date(now.getTime() - 86_400_000), timezone);
      return { from: y, to: y };
    }
    case 'last7':
      return {
        from: businessDateString(new Date(now.getTime() - 6 * 86_400_000), timezone),
        to: today,
      };
    case 'last30':
      return {
        from: businessDateString(new Date(now.getTime() - 29 * 86_400_000), timezone),
        to: today,
      };
    case 'custom':
      if (!range.from || !range.to) {
        throw new IdentityError('validation', 'A custom range needs both from and to dates');
      }
      if (range.from > range.to) {
        throw new IdentityError('validation', 'from must not be after to');
      }
      return { from: range.from, to: range.to };
    default:
      throw new IdentityError('validation', 'Unknown range kind');
  }
}

export interface FinancialSummary {
  outletId: string | null; // null = combined across outlets
  outletName: string | null;
  from: string;
  to: string;
  grossSales: string;
  discountTotal: string;
  refundTotal: string;
  netSales: string;
  cashTotal: string;
  upiTotal: string;
  complimentaryCount: number;
  billCount: number;
}

const ZERO: Omit<FinancialSummary, 'outletId' | 'outletName' | 'from' | 'to'> = {
  grossSales: '0.00',
  discountTotal: '0.00',
  refundTotal: '0.00',
  netSales: '0.00',
  cashTotal: '0.00',
  upiTotal: '0.00',
  complimentaryCount: 0,
  billCount: 0,
};

async function summarizeOutlets(
  client: PoolClient,
  outletIds: string[],
  from: string,
  to: string,
): Promise<Map<string, Omit<FinancialSummary, 'outletId' | 'outletName' | 'from' | 'to'>>> {
  if (outletIds.length === 0) return new Map();
  // Sales recognized on the bill's own business date within the period.
  const sales = await client.query<{
    outlet_id: string;
    gross: string;
    discount: string;
    cash: string;
    upi: string;
    comp_count: string;
    bill_count: string;
  }>(
    `select outlet_id,
            coalesce(sum(subtotal), 0)::numeric(12,2) as gross,
            coalesce(sum(discount_total), 0)::numeric(12,2) as discount,
            coalesce(sum(final_total) filter (where payment_method = 'cash'), 0)::numeric(12,2) as cash,
            coalesce(sum(final_total) filter (where payment_method = 'upi'), 0)::numeric(12,2) as upi,
            count(*) filter (where is_complimentary) as comp_count,
            count(*) as bill_count
       from billing.bills
      where outlet_id = any($1::uuid[]) and business_date between $2 and $3
      group by outlet_id`,
    [outletIds, from, to],
  );
  // Refunds recognized on the refund's OWN date within the period, regardless
  // of the original bill's business date.
  const refunds = await client.query<{ outlet_id: string; refunded: string }>(
    `select outlet_id, coalesce(sum(amount), 0)::numeric(12,2) as refunded
       from billing.refunds
      where outlet_id = any($1::uuid[]) and created_at::date between $2 and $3
      group by outlet_id`,
    [outletIds, from, to],
  );
  const refundByOutlet = new Map(refunds.rows.map((r) => [r.outlet_id, r.refunded]));

  const result = new Map<
    string,
    Omit<FinancialSummary, 'outletId' | 'outletName' | 'from' | 'to'>
  >();
  for (const row of sales.rows) {
    const refunded = refundByOutlet.get(row.outlet_id) ?? '0.00';
    result.set(row.outlet_id, {
      grossSales: row.gross,
      discountTotal: row.discount,
      refundTotal: refunded,
      // Net = menu value, less the discounts given, less refunds paid out.
      netSales: (Number(row.gross) - Number(row.discount) - Number(refunded)).toFixed(2),
      cashTotal: row.cash,
      upiTotal: row.upi,
      complimentaryCount: Number(row.comp_count),
      billCount: Number(row.bill_count),
    });
  }
  // An outlet with only refunds (no sales) in the period still needs a row.
  for (const [outletId, refunded] of refundByOutlet) {
    if (!result.has(outletId)) {
      result.set(outletId, {
        ...ZERO,
        refundTotal: refunded,
        netSales: (-Number(refunded)).toFixed(2),
      });
    }
  }
  return result;
}

function combine(
  summaries: Omit<FinancialSummary, 'outletId' | 'outletName' | 'from' | 'to'>[],
): Omit<FinancialSummary, 'outletId' | 'outletName' | 'from' | 'to'> {
  const sum = (f: (s: (typeof summaries)[number]) => string): string =>
    summaries.reduce((s, x) => s + Number(f(x)), 0).toFixed(2);
  return {
    grossSales: sum((s) => s.grossSales),
    discountTotal: sum((s) => s.discountTotal),
    refundTotal: sum((s) => s.refundTotal),
    netSales: sum((s) => s.netSales),
    cashTotal: sum((s) => s.cashTotal),
    upiTotal: sum((s) => s.upiTotal),
    complimentaryCount: summaries.reduce((s, x) => s + x.complimentaryCount, 0),
    billCount: summaries.reduce((s, x) => s + x.billCount, 0),
  };
}

export interface ReportFilter {
  franchiseId?: string;
  outletId?: string;
}

/** Shared by every report function below: resolve which outlets are in
 *  scope (Franchise Owner's own via RLS/`actor.scope.franchiseId`, or
 *  Central/Accountant optionally filtered) and the concrete date range for
 *  one representative outlet timezone — the same resolution
 *  `getFinancialReport` always did, now reused instead of repeated. */
async function resolveReportScope(
  client: PoolClient,
  actor: ActorContext,
  range: ReportRange,
  filter: ReportFilter,
): Promise<{
  outlets: { id: string; displayName: string }[];
  outletIds: string[];
  from: string;
  to: string;
}> {
  const params: unknown[] = [actor.scope.organizationId];
  let where = `organization_id = $1 and status <> 'closed'`;
  if (actor.scope.franchiseId) {
    params.push(actor.scope.franchiseId);
    where += ` and franchise_id = $${String(params.length)}`;
  } else if (filter.franchiseId) {
    params.push(filter.franchiseId);
    where += ` and franchise_id = $${String(params.length)}`;
  }
  if (filter.outletId) {
    params.push(filter.outletId);
    where += ` and id = $${String(params.length)}`;
  }
  const outlets = await client.query<{ id: string; display_name: string; timezone: string }>(
    `select id, display_name, timezone from billing.outlets where ${where} order by display_name`,
    params,
  );
  const timezone = outlets.rows[0]?.timezone ?? 'Asia/Kolkata';
  const { from, to } = resolveDateRange(range, timezone);
  return {
    outlets: outlets.rows.map((o) => ({ id: o.id, displayName: o.display_name })),
    outletIds: outlets.rows.map((o) => o.id),
    from,
    to,
  };
}

/** Franchise Owner: combined report across every owned outlet, plus a
 *  per-outlet drill-down. Central Admin / Accountant: same shape across every
 *  outlet in the organization, optionally filtered to one franchise/outlet. */
export async function getFinancialReport(
  pool: Pool,
  actor: ActorContext,
  range: ReportRange,
  filter: ReportFilter = {},
): Promise<{ combined: FinancialSummary; byOutlet: FinancialSummary[] }> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { outlets, outletIds, from, to } = await resolveReportScope(client, actor, range, filter);
    const byOutletMap = await summarizeOutlets(client, outletIds, from, to);
    const byOutlet: FinancialSummary[] = outlets.map((o) => ({
      outletId: o.id,
      outletName: o.displayName,
      from,
      to,
      ...(byOutletMap.get(o.id) ?? ZERO),
    }));
    const combined: FinancialSummary = {
      outletId: null,
      outletName: null,
      from,
      to,
      ...combine(byOutlet),
    };
    return { combined, byOutlet };
  });
}

export interface ReasonBreakdown {
  reason: string;
  amount: string;
  count: number;
}

/** Refunds are recognised on their own date, same as `getFinancialReport`. */
export async function getRefundReasonBreakdown(
  pool: Pool,
  actor: ActorContext,
  range: ReportRange,
  filter: ReportFilter = {},
): Promise<ReasonBreakdown[]> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { outletIds, from, to } = await resolveReportScope(client, actor, range, filter);
    if (outletIds.length === 0) return [];
    const { rows } = await client.query<{ reason: string; amount: string; count: string }>(
      `select reason,
              coalesce(sum(amount), 0)::numeric(12,2) as amount,
              count(*) as count
         from billing.refunds
        where outlet_id = any($1::uuid[]) and created_at::date between $2 and $3
        group by reason
        order by amount desc`,
      [outletIds, from, to],
    );
    return rows.map((r) => ({ reason: r.reason, amount: r.amount, count: Number(r.count) }));
  });
}

/** Discounts are recognised on the owning bill's business date, same as
 *  sales in `getFinancialReport` (a discount has no date of its own). */
export async function getDiscountReasonBreakdown(
  pool: Pool,
  actor: ActorContext,
  range: ReportRange,
  filter: ReportFilter = {},
): Promise<ReasonBreakdown[]> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { outletIds, from, to } = await resolveReportScope(client, actor, range, filter);
    if (outletIds.length === 0) return [];
    const { rows } = await client.query<{ reason: string; amount: string; count: string }>(
      `select d.reason,
              coalesce(sum(d.amount), 0)::numeric(12,2) as amount,
              count(*) as count
         from billing.bill_discounts d
         join billing.bills b on b.id = d.bill_id
        where b.outlet_id = any($1::uuid[]) and b.business_date between $2 and $3
        group by d.reason
        order by amount desc`,
      [outletIds, from, to],
    );
    return rows.map((r) => ({ reason: r.reason, amount: r.amount, count: Number(r.count) }));
  });
}

export interface EmployeeSalesRow {
  employeeId: string;
  employeeName: string;
  grossSales: string;
  discountTotal: string;
  refundTotal: string;
  netSales: string;
  billCount: number;
}

/** A refund isn't attributed to the original bill's cashier — the employee
 *  who processes a refund may not be who rang up the sale — so refunds here
 *  are grouped by the refund's own actor, same attribution logic as the
 *  refund-reason breakdown above, just split a second way. */
export async function getEmployeeSalesBreakdown(
  pool: Pool,
  actor: ActorContext,
  range: ReportRange,
  filter: ReportFilter = {},
): Promise<EmployeeSalesRow[]> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { outletIds, from, to } = await resolveReportScope(client, actor, range, filter);
    if (outletIds.length === 0) return [];
    const sales = await client.query<{
      employee_id: string;
      employee_name: string;
      gross: string;
      discount: string;
      bill_count: string;
    }>(
      `select employee_id, employee_name,
              coalesce(sum(subtotal), 0)::numeric(12,2) as gross,
              coalesce(sum(discount_total), 0)::numeric(12,2) as discount,
              count(*) as bill_count
         from billing.bills
        where outlet_id = any($1::uuid[]) and business_date between $2 and $3
        group by employee_id, employee_name`,
      [outletIds, from, to],
    );
    const refunds = await client.query<{
      actor_employee_id: string | null;
      actor_name: string;
      refunded: string;
    }>(
      `select actor_employee_id, actor_name, coalesce(sum(amount), 0)::numeric(12,2) as refunded
         from billing.refunds
        where outlet_id = any($1::uuid[]) and created_at::date between $2 and $3
        group by actor_employee_id, actor_name`,
      [outletIds, from, to],
    );
    const refundByEmployee = new Map<string, string>();
    for (const r of refunds.rows) {
      if (!r.actor_employee_id) continue;
      refundByEmployee.set(r.actor_employee_id, r.refunded);
    }
    return sales.rows.map((r) => {
      const refunded = refundByEmployee.get(r.employee_id) ?? '0.00';
      return {
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        grossSales: r.gross,
        discountTotal: r.discount,
        refundTotal: refunded,
        netSales: (Number(r.gross) - Number(r.discount) - Number(refunded)).toFixed(2),
        billCount: Number(r.bill_count),
      };
    });
  });
}

export interface TopItemRow {
  itemName: string;
  quantitySold: number;
  revenue: string;
}

/** Top-selling menu items by quantity, revenue alongside — `item_name` is
 *  denormalized onto `bill_lines` at sale time, so this survives an item
 *  being renamed or removed from the menu later. Same recognition rule as
 *  the rest of this file: a line counts on its bill's business date. */
export async function getTopSellingItems(
  pool: Pool,
  actor: ActorContext,
  range: ReportRange,
  filter: ReportFilter = {},
  limit = 10,
): Promise<TopItemRow[]> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { outletIds, from, to } = await resolveReportScope(client, actor, range, filter);
    if (outletIds.length === 0) return [];
    const { rows } = await client.query<{ item_name: string; qty: string; revenue: string }>(
      `select bl.item_name,
              sum(bl.quantity) as qty,
              sum(bl.final_total)::numeric(12,2) as revenue
         from billing.bill_lines bl
         join billing.bills b on b.id = bl.bill_id
        where b.outlet_id = any($1::uuid[]) and b.business_date between $2 and $3
        group by bl.item_name
        order by qty desc
        limit $4`,
      [outletIds, from, to, Math.min(Math.max(limit, 1), 50)],
    );
    return rows.map((r) => ({
      itemName: r.item_name,
      quantitySold: Number(r.qty),
      revenue: r.revenue,
    }));
  });
}

export interface CashSessionRow {
  id: string;
  outletId: string;
  outletName: string;
  businessDate: string;
  status: string;
  openedByName: string;
  openingCash: string;
  closedByName: string | null;
  closedAt: string | null;
  countedCash: string | null;
  expectedCash: string | null;
  variance: string | null;
  varianceReason: string | null;
}

/** Every cash session opened in the range, for reconciliation — not just the
 *  one currently open (that's `getOpenCashSession`'s job, live on the POS's
 *  own Close-register screen). */
export async function listCashSessionsForRange(
  pool: Pool,
  actor: ActorContext,
  range: ReportRange,
  filter: ReportFilter = {},
): Promise<CashSessionRow[]> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { outlets, outletIds, from, to } = await resolveReportScope(client, actor, range, filter);
    if (outletIds.length === 0) return [];
    const outletName = new Map(outlets.map((o) => [o.id, o.displayName]));
    const { rows } = await client.query<{
      id: string;
      outlet_id: string;
      business_date: string;
      status: string;
      opened_by_name: string;
      opening_cash: string;
      closed_by_name: string | null;
      closed_at: Date | null;
      counted_cash: string | null;
      expected_cash: string | null;
      variance: string | null;
      variance_reason: string | null;
    }>(
      `select id, outlet_id, business_date::text as business_date, status, opened_by_name,
              opening_cash, closed_by_name, closed_at, counted_cash, expected_cash, variance,
              variance_reason
         from billing.cash_sessions
        where outlet_id = any($1::uuid[]) and business_date between $2 and $3
        order by business_date desc, opened_at desc`,
      [outletIds, from, to],
    );
    return rows.map((r) => ({
      id: r.id,
      outletId: r.outlet_id,
      outletName: outletName.get(r.outlet_id) ?? '',
      businessDate: r.business_date,
      status: r.status,
      openedByName: r.opened_by_name,
      openingCash: r.opening_cash,
      closedByName: r.closed_by_name,
      closedAt: r.closed_at ? r.closed_at.toISOString() : null,
      countedCash: r.counted_cash,
      expectedCash: r.expected_cash,
      variance: r.variance,
      varianceReason: r.variance_reason,
    }));
  });
}
