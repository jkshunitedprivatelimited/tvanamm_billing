import { getFinancialReport, getRetentionStatus, type ReportRangeKind } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { RangeTabs } from './RangeTabs';
import { ByOutletTable } from './ByOutletTable';
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

      <h2 className="section-label">By outlet</h2>
      <ByOutletTable rows={byOutlet} />

      <RetentionPanel status={retention} />
    </main>
  );
}
