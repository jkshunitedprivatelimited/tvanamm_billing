import { getOperationalReports } from '@/server/operational-reports';
import { ReportRows } from './OperationalReport';
import { ReportCategoryNav } from './ReportCategoryNav';
import { ReportOutletFilter } from './ReportOutletFilter';
import {
  listOutlets,
  getFinancialReport,
  getRetentionStatus,
  getRefundReasonBreakdown,
  getDiscountReasonBreakdown,
  getEmployeeSalesBreakdown,
  getTopSellingItems,
  listCashSessionsForRange,
  type ReportRange,
  type ReportRangeKind,
} from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { RangeTabs } from './RangeTabs';
import { ByOutletTable } from './ByOutletTable';
import { RetentionPanel } from './RetentionPanel';
import { ReasonBreakdownTable } from './ReasonBreakdownTable';
import { EmployeeBreakdownTable } from './EmployeeBreakdownTable';
import { CashSessionsTable } from './CashSessionsTable';
import { TopItemsTable } from './TopItemsTable';

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  custom: 'Custom range',
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    from?: string;
    to?: string;
    outletId?: string;
    franchiseId?: string;
    category?: string;
  }>;
}) {
  const actor = await requireAdminActor();
  const sp = await searchParams;
  const isOwner = actor.role === 'franchise_owner';
  const kind: ReportRangeKind =
    sp.range === 'today' ||
    sp.range === 'yesterday' ||
    sp.range === 'last30' ||
    sp.range === 'custom'
      ? sp.range
      : 'last7';
  const range: ReportRange =
    kind === 'custom' && sp.from && sp.to ? { kind, from: sp.from, to: sp.to } : { kind };

  const categories = [
    {
      key: 'overview',
      label: 'Sales overview',
      description: isOwner
        ? 'Track your sales, payments and growth over time.'
        : 'Sales, payments and outlet comparison.',
    },
    ...(actor.role === 'central_admin'
      ? [
          {
            key: 'health',
            label: 'Outlet health',
            description:
              'Compare outlet sales with the preceding period and review setup readiness.',
          },
        ]
      : []),
    {
      key: 'items',
      label: isOwner ? 'Top-selling items' : 'Menu performance',
      description: isOwner
        ? 'Top-selling items at your outlet, with quantities sold and revenue for the selected period.'
        : 'See which items sell most in the selected outlets.',
    },
    {
      key: 'team',
      label: isOwner ? 'Team' : 'Team performance',
      description: isOwner
        ? 'Review your team’s attendance, working hours and sales.'
        : 'Sales and refunds attributed to each employee.',
    },
    {
      key: 'adjustments',
      label: 'Discounts & refunds',
      description: isOwner
        ? 'Review discounts and refunds at your outlet and the reasons recorded by your team.'
        : 'Understand why sales were discounted or refunded.',
    },
    {
      key: 'cash',
      label: 'Cash reconciliation',
      description: isOwner
        ? 'Check your closing cash and any differences reported by your team.'
        : 'Compare expected cash with counted cash at closing.',
    },
    {
      key: 'expenses',
      label: 'Expenses',
      description: isOwner
        ? 'See what your team spent and which expense categories cost the most.'
        : 'Recorded spending by outlet and category. Amounts in rupees.',
    },
    {
      key: 'attendance',
      label: 'Attendance',
      description: isOwner
        ? 'Review your team’s check-ins, check-outs and completed working hours.'
        : 'Check-ins and completed hours. Open sessions are not counted as completed hours.',
    },
    {
      key: 'stock',
      label: 'Stock & wastage',
      description: isOwner
        ? 'Track stock received, used and wasted at your outlet during the selected period.'
        : 'Recorded opening balance, additions and removals through the selected end date.',
    },
    {
      key: 'supply',
      label: 'Supply orders',
      description: isOwner
        ? 'Review your supply orders, order values and delivery progress.'
        : 'Orders placed in this period, grouped by their current status. Values in rupees; these are separate from customer sales.',
    },
    ...(actor.role === 'central_admin'
      ? [
          {
            key: 'purchasing',
            label: 'Purchases & suppliers',
            description:
              'Central purchase orders and invoices issued in this period. Amounts in rupees.',
          },
        ]
      : []),
    {
      key: 'exports',
      label: 'Exports & records',
      description: 'Download billing records and review archive coverage.',
    },
  ].filter((category) => !isOwner || !['adjustments', 'attendance'].includes(category.key));
  const requestedCategory =
    isOwner && sp.category === 'attendance'
      ? 'team'
      : isOwner && sp.category === 'adjustments'
        ? 'overview'
        : sp.category;
  const category = categories.find((c) => c.key === requestedCategory) ?? categories[0];
  if (!category) throw new Error('No report categories configured');
  const showAdjustments =
    category.key === 'adjustments' || (isOwner && category.key === 'overview');
  const filter = {
    ...(sp.outletId ? { outletId: sp.outletId } : {}),
    ...(sp.franchiseId ? { franchiseId: sp.franchiseId } : {}),
  };
  const [
    outlets,
    { combined, byOutlet },
    retention,
    refundReasons,
    discountReasons,
    byEmployee,
    cashSessions,
    topItems,
  ] = await Promise.all([
    listOutlets(db(), actor),
    getFinancialReport(db(), actor, range, filter),
    category.key === 'exports' ? getRetentionStatus(db(), actor) : Promise.resolve(null),
    showAdjustments ? getRefundReasonBreakdown(db(), actor, range, filter) : Promise.resolve([]),
    showAdjustments ? getDiscountReasonBreakdown(db(), actor, range, filter) : Promise.resolve([]),
    category.key === 'team'
      ? getEmployeeSalesBreakdown(db(), actor, range, filter)
      : Promise.resolve([]),
    category.key === 'cash'
      ? listCashSessionsForRange(db(), actor, range, filter)
      : Promise.resolve([]),
    category.key === 'items' ? getTopSellingItems(db(), actor, range, filter) : Promise.resolve([]),
  ]);
  const outletName = sp.outletId
    ? (outlets.find((o) => o.id === sp.outletId)?.displayName ?? 'Unavailable outlet')
    : sp.franchiseId
      ? (outlets.find((o) => o.franchiseId === sp.franchiseId)?.franchiseName ??
        'Selected franchise')
      : outlets.length === 1
        ? (outlets[0]?.displayName ?? 'Your outlet')
        : 'All accessible outlets';
  const operations =
    (isOwner && category.key === 'team') ||
    ['expenses', 'attendance', 'stock', 'supply', 'purchasing'].includes(category.key)
      ? await getOperationalReports(actor, combined.from, combined.to, sp.outletId, sp.franchiseId)
      : null;
  const periodDays =
    Math.round((Date.parse(combined.to) - Date.parse(combined.from)) / 86400000) + 1;
  const previousEnd = new Date(Date.parse(combined.from) - 86400000).toISOString().slice(0, 10);
  const previousStart = new Date(Date.parse(combined.from) - periodDays * 86400000)
    .toISOString()
    .slice(0, 10);
  const previous =
    category.key === 'health' || (isOwner && category.key === 'overview')
      ? await getFinancialReport(
          db(),
          actor,
          { kind: 'custom', from: previousStart, to: previousEnd },
          filter,
        )
      : null;
  const exportParams = new URLSearchParams({ from: combined.from, to: combined.to, ...filter });
  function categoryHref(key: string) {
    const params = new URLSearchParams({ range: kind, category: key, ...filter });
    if (sp.from) params.set('from', sp.from);
    if (sp.to) params.set('to', sp.to);
    return `/reports?${params.toString()}`;
  }

  return (
    <main className="reports-workspace">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">
            {isOwner ? 'Your business performance' : 'Business performance'}
          </p>
          <h1>Reports</h1>
        </div>
        <a
          className="btn secondary report-download"
          href={`/api/v1/reports/export?${exportParams.toString()}`}
        >
          Download bills CSV
        </a>
      </div>
      <p>
        <a href="/ai">Ask JKSH AI about these reports →</a>
      </p>
      <ReportOutletFilter
        outlets={outlets.map((o) => ({
          id: o.id,
          name: o.displayName,
          franchiseId: o.franchiseId ?? null,
          franchiseName: o.franchiseName ?? null,
        }))}
      />
      <p className="page-intro">
        <strong>{outletName}</strong> · {RANGE_LABEL[kind]} ({combined.from} to {combined.to}).
      </p>

      <RangeTabs
        current={kind}
        {...(sp.from ? { customFrom: sp.from } : {})}
        {...(sp.to ? { customTo: sp.to } : {})}
      />

      <ReportCategoryNav
        current={category.key}
        categories={categories.map((c) => ({
          key: c.key,
          label: c.label,
          href: categoryHref(c.key),
        }))}
      />
      {isOwner ? (
        <p>
          <a href={`${categoryHref('overview')}#discounts-refunds`}>
            View discounts &amp; refunds →
          </a>
        </p>
      ) : null}
      <section aria-labelledby="report-title">
        <h2 id="report-title">{category.label}</h2>
        <p className="page-intro">
          {isOwner && category.key === 'items' && !sp.outletId && outlets.length > 1
            ? 'Top-selling items across your outlets, with quantities sold and revenue for the selected period.'
            : category.description}
        </p>
        {category.key === 'health' && previous ? (
          <ReportRows
            title="Outlet performance & readiness"
            note={`Compared with ${previousStart} to ${previousEnd}. No recorded sales does not by itself mean an outlet is closed or offline.`}
            rows={byOutlet.map((o) => {
              const prior = previous.byOutlet.find((p) => p.outletId === o.outletId);
              const before = Number(prior?.netSales ?? 0);
              const detail = outlets.find((p) => p.id === o.outletId);
              return {
                outlet: o.outletName,
                net_sales: Number(o.netSales).toFixed(2),
                previous_net_sales: before.toFixed(2),
                change:
                  before > 0
                    ? `${(((Number(o.netSales) - before) / before) * 100).toFixed(1)}%`
                    : 'No prior sales',
                bills: o.billCount,
                average_bill: o.billCount
                  ? (Number(o.netSales) / o.billCount).toFixed(2)
                  : 'No bills',
                billing_device: detail?.hasActiveTerminal ? 'Registered' : 'Setup needed',
                status: detail?.status ?? 'Unknown',
              };
            })}
          />
        ) : null}
        {operations ? (
          <>
            {category.key === 'expenses' ? (
              <ReportRows title="Outlet expenses" rows={operations.billing.expenses} />
            ) : null}
            {category.key === 'attendance' || (isOwner && category.key === 'team') ? (
              <ReportRows title="Attendance" rows={operations.billing.attendance} />
            ) : null}
            {['stock', 'supply', 'purchasing'].includes(category.key) && !operations.stock ? (
              <p className="notice">Stock reports are temporarily unavailable. Please retry.</p>
            ) : null}
            {category.key === 'stock' && operations.stock ? (
              <>
                <ReportRows
                  title="Stock movement"
                  rows={operations.stock.movements}
                  note="See how much stock you started with, received, used or removed, and had left. Items you haven’t counted yet have no confirmed starting balance."
                />
                <ReportRows title="Wastage" rows={operations.stock.wastage} />
              </>
            ) : null}
            {category.key === 'supply' && operations.stock ? (
              <ReportRows
                title="Outlet supply orders"
                rows={operations.stock.orders}
                note="Order value is not recognized profit or confirmed payment. Drafts and cancelled orders remain separate by status."
              />
            ) : null}
            {category.key === 'purchasing' && operations.stock ? (
              <>
                <ReportRows title="Purchase orders" rows={operations.stock.purchases} />
                <ReportRows
                  title="Supplier invoices"
                  rows={operations.stock.suppliers}
                  note="Invoices dated within this period; payments recorded up to the end date. This is not a complete all-time payable balance. Profit requires complete ingredient and operating costs."
                />
              </>
            ) : null}
          </>
        ) : null}
        {category.key === 'overview' ? (
          <>
            <div
              className="card grid"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
            >
              <Metric label="Net sales" value={`₹${combined.netSales}`} />
              <Metric label="Bills" value={String(combined.billCount)} />
              <Metric label="Cash payments" value={`₹${combined.cashTotal}`} />
              <Metric label="UPI payments" value={`₹${combined.upiTotal}`} />
              <Metric label="Gross sales" value={`₹${combined.grossSales}`} />
              <Metric label="Discounts" value={`₹${combined.discountTotal}`} />
              <Metric label="Refunds" value={`₹${combined.refundTotal}`} />
              <Metric label="Complimentary bills" value={String(combined.complimentaryCount)} />
            </div>
            {isOwner && previous ? (
              <div className="card">
                <h3>Sales trend</h3>
                <p className="muted">
                  Compared with {previousStart} to {previousEnd}.
                </p>
                <div
                  className="grid"
                  style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
                >
                  <Metric label="Previous net sales" value={`₹${previous.combined.netSales}`} />
                  <Metric
                    label="Change in net sales"
                    value={
                      Number(previous.combined.netSales) > 0
                        ? `${(((Number(combined.netSales) - Number(previous.combined.netSales)) / Number(previous.combined.netSales)) * 100).toFixed(1)}%`
                        : 'No prior sales to compare'
                    }
                  />
                  <Metric
                    label="Average bill"
                    value={
                      combined.billCount
                        ? `₹${(Number(combined.netSales) / combined.billCount).toFixed(2)}`
                        : 'No bills in this period'
                    }
                  />
                </div>
              </div>
            ) : null}
            <h3>{outlets.length === 1 ? 'Outlet summary' : 'Outlet comparison'}</h3>
            <ByOutletTable rows={byOutlet} />
          </>
        ) : null}
        {category.key === 'items' ? <TopItemsTable rows={topItems} /> : null}
        {category.key === 'team' ? (
          <>
            <h3>Sales by employee</h3>
            <EmployeeBreakdownTable rows={byEmployee} />
          </>
        ) : null}
        {showAdjustments ? (
          <section
            id="discounts-refunds"
            className="card"
            style={{ scrollMarginTop: 140 }}
            aria-labelledby="discounts-refunds-title"
          >
            <h3 id="discounts-refunds-title">Discounts &amp; refunds</h3>
            <p>Amounts and reasons recorded for the selected period.</p>
            <h3>Discount reasons</h3>
            <ReasonBreakdownTable
              rows={discountReasons}
              empty="No discounts given in this range."
            />
            <h3>Refund reasons</h3>
            <ReasonBreakdownTable rows={refundReasons} empty="No refunds in this range." />
          </section>
        ) : null}
        {category.key === 'cash' ? <CashSessionsTable rows={cashSessions} /> : null}
        {retention ? (
          <>
            <p className="muted">
              Archive coverage below applies to your entire accessible workspace. The bills download
              above uses your selected outlet and dates.
            </p>
            <RetentionPanel status={retention} />
          </>
        ) : null}
      </section>
      <details className="report-help">
        <summary>How are these figures calculated?</summary>
        <p className="muted">
          Sales use the bill date; refunds use the refund date. Net sales = menu value − discounts −
          refunds. Cash and UPI show payments, not profit.
        </p>
      </details>
    </main>
  );
}
