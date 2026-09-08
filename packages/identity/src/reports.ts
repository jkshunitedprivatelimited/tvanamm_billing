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

/** Franchise Owner: combined report across every owned outlet, plus a
 *  per-outlet drill-down. Central Admin / Accountant: same shape across every
 *  outlet in the organization, optionally filtered to one franchise/outlet. */
export async function getFinancialReport(
  pool: Pool,
  actor: ActorContext,
  range: ReportRange,
  filter: { franchiseId?: string; outletId?: string } = {},
): Promise<{ combined: FinancialSummary; byOutlet: FinancialSummary[] }> {
  ensureAllowed(actor, 'billing.report.store', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
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
    const outletIds = outlets.rows.map((o) => o.id);
    const timezone = outlets.rows[0]?.timezone ?? 'Asia/Kolkata';
    const { from, to } = resolveDateRange(range, timezone);

    const byOutletMap = await summarizeOutlets(client, outletIds, from, to);
    const byOutlet: FinancialSummary[] = outlets.rows.map((o) => ({
      outletId: o.id,
      outletName: o.display_name,
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
