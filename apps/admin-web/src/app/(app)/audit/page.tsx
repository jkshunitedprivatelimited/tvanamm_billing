import Link from 'next/link';
import { getFinancialReport, listOutlets } from '@jksh/identity';
import { listCentralLowStockAlerts, getCentralOversight, listLowStockItems } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';
import { DashboardRefresh } from '@/components/DashboardRefresh';

export default async function BusinessOverview({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const actor = await requireAdminActor();
  const isOwner = actor.role === 'franchise_owner';
  const params = await searchParams;
  const range = params.range === 'last7' || params.range === 'last30' ? params.range : 'today';
  const [outlets, report] = await Promise.all([
    listOutlets(db(), actor),
    getFinancialReport(db(), actor, { kind: range }),
  ]);
  const stock =
    actor.role === 'central_admin' || actor.role === 'franchise_owner'
      ? await (async () => {
          try {
            if (actor.role === 'franchise_owner') {
              const results = await Promise.all(
                outlets.map(async (o) => {
                  const a = await stockActorFor(actor, { outletId: o.id });
                  const items = await listLowStockItems(stockDb(), a, o.id);
                  return {
                    alerts: items.filter((i) => i.low).map((i) => ({ ...i, outletId: o.id })),
                    uncounted: items.filter((i) => !i.trackingStarted).length,
                    outletId: o.id,
                  };
                }),
              );
              return {
                alerts: results.flatMap((r) => r.alerts),
                uncounted: results.filter((r) => r.uncounted > 0),
                summary: { stockValuePaise: null },
              };
            }
            const a = await stockActorFor(actor);
            const [alerts, summary] = await Promise.all([
              listCentralLowStockAlerts(stockDb(), a),
              getCentralOversight(stockDb(), a, a.organizationId),
            ]);
            return { alerts, summary, uncounted: [] };
          } catch {
            return null;
          }
        })()
      : null;
  const active = outlets.filter((o) => o.status === 'active');
  const total = report.combined;
  const money = (v: string | number) =>
    `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const selling = report.byOutlet.filter((o) => o.billCount > 0).length;
  const shortages = stock?.alerts.filter((a) => outlets.some((o) => o.id === a.outletId)) ?? [];
  return (
    <main className="business-overview">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">
            {isOwner
              ? outlets.length === 1
                ? outlets[0]?.displayName
                : 'Your outlets'
              : 'T VANAMM · Business performance'}
          </p>
          <h1>
            {isOwner
              ? outlets.length > 1
                ? 'Your outlets at a glance'
                : 'Your outlet at a glance'
              : 'Your business, at a glance'}
          </h1>
          <p className="page-intro">
            {isOwner
              ? 'See your sales, payments and items to restock.'
              : 'Sales, outlet readiness and stock issues that need your attention.'}
          </p>
        </div>
        <DashboardRefresh />
      </div>
      <nav className="section-tabs" aria-label="Reporting period">
        {(
          [
            ['today', 'Today'],
            ['last7', 'Last 7 days'],
            ['last30', 'Last 30 days'],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/audit?range=${key}`}
            aria-current={range === key ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
        <span className="muted">
          {total.from} — {total.to} · India time
        </span>
      </nav>
      <div className="performance-grid">
        <article className="performance-card featured">
          <span>Net sales</span>
          <strong>{money(total.netSales)}</strong>
          <small>After discounts and refunds</small>
        </article>
        <article className="performance-card">
          <span>Bills completed</span>
          <strong>{total.billCount}</strong>
          <small>
            {isOwner
              ? 'Completed bills in the selected period'
              : `${String(selling)} outlets with sales in this period`}
          </small>
        </article>
        <article className="performance-card">
          <span>Average bill</span>
          <strong>{money(total.billCount ? Number(total.netSales) / total.billCount : 0)}</strong>
          <small>Net sales per completed bill</small>
        </article>
        <article className="performance-card">
          <span>Low-stock items</span>
          <strong>{stock ? shortages.length : '—'}</strong>
          <small>
            {stock
              ? isOwner
                ? 'Items at or below your stock limits'
                : 'Latest stock checks · up to 100 alerts'
              : 'Stock information is temporarily unavailable'}
          </small>
        </article>
      </div>
      <div className="operations-columns">
        <section className="card">
          <div className="section-heading">
            <h2>{isOwner ? 'Your next steps' : 'Needs attention'}</h2>
            <Link
              href={
                isOwner && outlets.length === 1 ? `/stock/${outlets[0]?.id ?? ''}/alerts` : '/stock'
              }
            >
              {isOwner ? 'View your stock →' : 'Stock control →'}
            </Link>
          </div>
          {!stock ? (
            <p className="notice">Stock status is temporarily unavailable. Refresh to retry.</p>
          ) : null}
          {shortages.slice(0, 5).map((a) => (
            <Link
              className="attention-row"
              key={`${a.outletId}:${a.itemId}`}
              href={`/stock/${a.outletId}/alerts`}
            >
              <span>
                <strong>{a.name} is running low</strong>
                <small>
                  {outlets.find((o) => o.id === a.outletId)?.displayName} · {Number(a.quantity)}{' '}
                  {a.baseUnit} remaining
                </small>
              </span>
              <span>Review →</span>
            </Link>
          ))}
          {(!isOwner ? active : [])
            .filter((o) => !o.hasActiveTerminal)
            .map((o) => (
              <Link className="attention-row" key={o.id} href={`/outlets/${o.id}?section=setup`}>
                <span>
                  <strong>{o.displayName}</strong>
                  <small>Billing device has not been registered</small>
                </span>
                <span>Set up →</span>
              </Link>
            ))}
          {isOwner
            ? stock?.uncounted.map((entry) => (
                <Link
                  key={entry.outletId}
                  className="attention-row"
                  href={`/stock/${entry.outletId}/alerts`}
                >
                  <span>
                    <strong>Enter your starting stock</strong>
                    <small>
                      {entry.uncounted} items haven’t been counted yet
                      {outlets.length > 1
                        ? ` · ${outlets.find((o) => o.id === entry.outletId)?.displayName ?? 'Your outlet'}`
                        : ''}
                      . You can enter quantities now or start when your next delivery arrives.
                    </small>
                  </span>
                  <span>Enter stock →</span>
                </Link>
              ))
            : null}
          {!isOwner && stock?.summary.stockValuePaise === 0 ? (
            <div className="attention-row">
              <span>
                <strong>Opening stock needs review</strong>
                <small>
                  Enter your current stock or confirm your next delivery to start tracking supplies.
                  Billing continues while you complete stock setup.
                </small>
              </span>
              <Link
                href={
                  actor.role === 'central_admin'
                    ? '/stock/ops/catalog'
                    : `/stock/${active[0]?.id ?? ''}/alerts`
                }
              >
                Review stock →
              </Link>
            </div>
          ) : null}
          {isOwner && stock && shortages.length === 0 && stock.uncounted.length === 0 ? (
            <p className="muted">
              No low-stock alerts. You can review quantities and set reminders in your stock page.
            </p>
          ) : null}
          {!isOwner &&
          shortages.length === 0 &&
          active.every((o) => o.hasActiveTerminal) &&
          stock &&
          Number(stock.summary.stockValuePaise) > 0 ? (
            <p className="muted">No low-stock or device issues in the latest checks.</p>
          ) : null}
        </section>
        <section className="card">
          <h2>Sales breakdown</h2>
          <dl className="money-breakdown">
            <div>
              <dt>Cash</dt>
              <dd>{money(total.cashTotal)}</dd>
            </div>
            <div>
              <dt>UPI</dt>
              <dd>{money(total.upiTotal)}</dd>
            </div>
            <div>
              <dt>Discounts</dt>
              <dd>{money(total.discountTotal)}</dd>
            </div>
            <div>
              <dt>Refunds</dt>
              <dd>{money(total.refundTotal)}</dd>
            </div>
          </dl>
          <Link href={`/reports?range=${range}`}>View sales details →</Link>
        </section>
      </div>
      {!isOwner || outlets.length > 1 ? (
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Outlet performance</h2>
              <p className="muted">
                {isOwner
                  ? 'Sales and stock reminders for each of your outlets.'
                  : `${String(active.length)} active outlets · a zero means no bills in this period, not an offline store.`}
              </p>
            </div>
            <Link href="/">{isOwner ? 'Your outlets →' : 'Manage outlets →'}</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Net sales</th>
                  <th>Bills</th>
                  <th>Stock alerts</th>
                  <th>Next step</th>
                </tr>
              </thead>
              <tbody>
                {outlets.map((o) => {
                  const row = report.byOutlet.find((r) => r.outletId === o.id);
                  const alerts = shortages.filter((a) => a.outletId === o.id).length;
                  return (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.displayName}</strong>
                        <div className="muted">{o.status}</div>
                      </td>
                      <td>{money(row?.netSales ?? 0)}</td>
                      <td>{row?.billCount ?? 0}</td>
                      <td>{stock ? alerts : '—'}</td>
                      <td>
                        <Link href={`/outlets/${o.id}`}>Open outlet →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <div className="overview-footer">
        <span>Updates every minute while this page is visible.</span>
        <Link href="/audit/history">Recent changes →</Link>
      </div>
    </main>
  );
}
