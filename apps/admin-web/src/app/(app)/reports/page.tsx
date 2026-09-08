import { getFinancialReport, getRetentionStatus } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { RetentionPanel } from './RetentionPanel';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

export default async function ReportsPage() {
  const actor = await requireAdminActor();
  const [{ combined, byOutlet }, retention] = await Promise.all([
    getFinancialReport(db(), actor, { kind: 'last7' }),
    getRetentionStatus(db(), actor),
  ]);

  return (
    <main>
      <h1>Reports</h1>
      <p className="muted">
        Last 7 days ({combined.from} to {combined.to})
        {actor.role === 'accountant'
          ? ' · read-only across every outlet; GST detail and Excel export arrive in a later pass.'
          : ''}
      </p>
      <div
        className="card"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}
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
          <h2 style={{ marginTop: 24 }}>By outlet</h2>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Gross</th>
                  <th>Discounts</th>
                  <th>Refunds</th>
                  <th>Net</th>
                  <th>Cash</th>
                  <th>UPI</th>
                  <th>Bills</th>
                </tr>
              </thead>
              <tbody>
                {byOutlet.map((o) => (
                  <tr key={o.outletId}>
                    <td>{o.outletName}</td>
                    <td>₹{o.grossSales}</td>
                    <td>₹{o.discountTotal}</td>
                    <td>₹{o.refundTotal}</td>
                    <td>₹{o.netSales}</td>
                    <td>₹{o.cashTotal}</td>
                    <td>₹{o.upiTotal}</td>
                    <td>{o.billCount}</td>
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
