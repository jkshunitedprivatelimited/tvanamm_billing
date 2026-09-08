import { getFinancialReport, getRetentionStatus, type ReportRangeKind } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { RangeTabs } from './RangeTabs';
import { RetentionPanel } from './RetentionPanel';

const RANGE_LABEL: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
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
  searchParams: Promise<{ range?: string }>;
}) {
  const actor = await requireAdminActor();
  const raw = (await searchParams).range;
  const range: ReportRangeKind =
    raw === 'today' || raw === 'yesterday' || raw === 'last30' ? raw : 'last7';

  const [{ combined, byOutlet }, retention] = await Promise.all([
    getFinancialReport(db(), actor, { kind: range }),
    getRetentionStatus(db(), actor),
  ]);

  return (
    <main>
      <h1>Reports</h1>
      <p className="page-intro">
        {RANGE_LABEL[range]} ({combined.from} to {combined.to}) · sales recognised on the bill date,
        refunds on the refund date. Net sales = menu value − discounts − refunds.
      </p>

      <RangeTabs current={range} />

      <div
        className="card grid"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}
      >
        <Metric label="Gross sales" value={`₹${combined.grossSales}`} />
        <Metric label="Discounts" value={`₹${combined.discountTotal}`} />
        <Metric label="Refunds" value={`₹${combined.refundTotal}`} />
        <Metric label="Net sales" value={`₹${combined.netSales}`} />
        <Metric label="Cash" value={`₹${combined.cashTotal}`} />
        <Metric label="UPI" value={`₹${combined.upiTotal}`} />
        <Metric label="Bills" value={String(combined.billCount)} />
        <Metric label="Complimentary" value={String(combined.complimentaryCount)} />
      </div>

      {byOutlet.length > 0 ? (
        <>
          <h2 className="section-label">By outlet</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th className="num">Gross</th>
                  <th className="num">Discounts</th>
                  <th className="num">Refunds</th>
                  <th className="num">Net</th>
                  <th className="num">Cash</th>
                  <th className="num">UPI</th>
                  <th className="num">Bills</th>
                </tr>
              </thead>
              <tbody>
                {byOutlet.map((o) => (
                  <tr key={o.outletId}>
                    <td>{o.outletName}</td>
                    <td className="num">₹{o.grossSales}</td>
                    <td className="num">₹{o.discountTotal}</td>
                    <td className="num">₹{o.refundTotal}</td>
                    <td className="num">₹{o.netSales}</td>
                    <td className="num">₹{o.cashTotal}</td>
                    <td className="num">₹{o.upiTotal}</td>
                    <td className="num">{o.billCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">No outlets in scope yet.</p>
      )}

      <RetentionPanel status={retention} />
    </main>
  );
}
