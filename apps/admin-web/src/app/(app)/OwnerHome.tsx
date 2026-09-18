import Link from 'next/link';
import { getFinancialReport } from '@jksh/identity';
import type { ActorContext, OutletSummary } from '@jksh/contracts';
import { db } from '@/server/pool';

export async function OwnerHome({
  outlets,
  actor,
}: {
  outlets: OutletSummary[];
  actor: ActorContext;
}) {
  const single = outlets.length === 1 ? outlets[0] : undefined;
  const report = await getFinancialReport(db(), actor, { kind: 'today' }).catch(() => null);
  const money = (value: string) =>
    `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <main className="owner-dashboard">
      <div className="owner-hero">
        <div>
          <p className="eyebrow">
            {single ? 'Your outlet · Overview' : 'Your franchise · Overview'}
          </p>
          <h1>{single?.displayName ?? 'Your business, at a glance'}</h1>
          <p>
            {single
              ? `${single.brandName}${single.city ? ` · ${single.city}` : ''}`
              : `${String(outlets.length)} outlets · Sales, expenses and team in one place`}
          </p>
        </div>
        {single ? (
          <Link className="btn" href={`/outlets/${single.id}`}>
            View bills & payments <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <Link className="btn" href="/reports">
            Compare outlet performance →
          </Link>
        )}
      </div>
      {single && !single.hasActiveTerminal ? (
        <div className="setup-notice">
          <div>
            <strong>Set up your billing device</strong>
            <p>Connect a counter device so your team can start billing.</p>
          </div>
          <Link href={`/outlets/${single.id}?section=setup`}>Set up device →</Link>
        </div>
      ) : null}
      <div className="section-heading">
        <h2>Today’s performance</h2>
        <Link href={single ? `/reports?range=today&outletId=${single.id}` : '/reports?range=today'}>
          Full report →
        </Link>
      </div>
      {report ? (
        <div className="owner-metrics">
          {[
            ['Net sales', money(report.combined.netSales), 'After discounts and refunds'],
            ['Bills', String(report.combined.billCount), 'Bills created today'],
            ['Cash payments', money(report.combined.cashTotal), 'Collected in cash'],
            ['UPI payments', money(report.combined.upiTotal), 'Digital collections'],
          ].map(([label, value, hint]) => (
            <div className="owner-metric" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{hint}</small>
            </div>
          ))}
        </div>
      ) : (
        <div className="card muted">
          Today’s sales are temporarily unavailable. Open Reports to retry.
        </div>
      )}
      <div className="section-heading">
        <h2>{single ? 'Manage your outlet' : 'Your outlets'}</h2>
        {single ? <span className="pill">{single.status}</span> : null}
      </div>
      {single ? (
        <div className="owner-task-grid">
          {(
            [
              [
                'billing',
                'Bills & payments',
                'Find receipts, review sales and manage refunds.',
                `/outlets/${single.id}`,
                '₹',
              ],
              [
                'expenses',
                'Outlet expenses',
                'Review daily spending and approve expenses.',
                `/outlets/${single.id}?section=expenses`,
                '↗',
              ],
              [
                'team',
                'Team & attendance',
                'See attendance and manage your outlet team.',
                `/outlets/${single.id}?section=attendance`,
                '◎',
              ],
              [
                'stock',
                'Wastage & stock',
                'Review recorded wastage and see upcoming stock features.',
                `/stock/${single.id}`,
                '▦',
              ],
            ] as const
          ).map(([key, title, description, href, icon]) => (
            <Link className="owner-task" key={key} href={href}>
              <span className="owner-task-icon" aria-hidden="true">
                {icon}
              </span>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
              <span className="owner-task-arrow" aria-hidden="true">
                ↗
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="owner-task-grid">
          {outlets.map((outlet) => {
            const summary = report?.byOutlet.find((o) => o.outletId === outlet.id);
            return (
              <Link className="owner-task" key={outlet.id} href={`/outlets/${outlet.id}`}>
                <span className="owner-task-icon" aria-hidden="true">
                  ▦
                </span>
                <div>
                  <strong>{outlet.displayName}</strong>
                  <p>
                    {outlet.city} · {outlet.status}
                  </p>
                  <span className="muted">
                    {summary
                      ? `${money(summary.netSales)} today · ${String(summary.billCount)} bills`
                      : 'Open outlet workspace'}
                  </span>
                </div>
                <span className="owner-task-arrow" aria-hidden="true">
                  ↗
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {!outlets.length ? (
        <div className="card">
          <h2>No outlets assigned yet</h2>
          <p className="muted">
            Your outlet dashboard will appear here once your outlet setup is complete.
          </p>
        </div>
      ) : null}
      <div className="owner-footer">
        <div>
          <strong>Keep track of changes</strong>
          <p>Review your outlet’s sales and payments.</p>
        </div>
        <Link href="/audit">Open outlet overview →</Link>
      </div>
    </main>
  );
}
