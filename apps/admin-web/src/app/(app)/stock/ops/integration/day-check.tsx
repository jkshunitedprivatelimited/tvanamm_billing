'use client';
import { useState } from 'react';
import type { OutletDayReconciliation, SyncCategory } from '@jksh/stock';

const LABELS: Record<SyncCategory, string> = {
  processed: 'Stock updated',
  shortage: 'Updated, stock went below zero',
  refund_recorded: 'Refunds recorded',
  not_sent: 'Not sent yet',
  send_failed: 'Sending failed',
  not_received: 'Missing in Stock',
  waiting: 'Waiting in Stock',
  failed: 'Stock could not process',
  result_missing: 'Result not back in Billing',
};
const ORDER: SyncCategory[] = [
  'processed',
  'shortage',
  'refund_recorded',
  'not_sent',
  'waiting',
  'result_missing',
  'send_failed',
  'not_received',
  'failed',
];
const BAD: SyncCategory[] = ['send_failed', 'not_received', 'failed'];

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function DayCheck({ outlets }: { outlets: { id: string; name: string }[] }) {
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? '');
  const [businessDate, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<OutletDayReconciliation | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/stock/reconciliation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outletId, businessDate }),
      });
      const body = (await res.json().catch(() => ({}))) as OutletDayReconciliation & {
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? 'Could not run the check.');
      setReport(body);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Could not run the check.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Check one outlet’s day</h2>
      <p>
        Follows every bill and refund from Billing into Stock and back, and checks that the stock
        taken matches each recipe.
      </p>
      <form className="row wrap" style={{ gap: 10, alignItems: 'end' }} onSubmit={run}>
        <label>
          Outlet
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} required>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Business date
          <input
            type="date"
            value={businessDate}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <button disabled={busy || !outletId}>{busy ? 'Checking…' : 'Run check'}</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      {report ? (
        <div style={{ marginTop: 14 }}>
          <p className={report.balanced ? 'ok' : 'error'}>
            {report.balanced
              ? `All ${String(report.sales)} bills and ${String(report.refunds)} refunds match.`
              : `${String(report.problems.length + report.ledgerMismatches.length)} difference(s) across ${String(report.sales)} bills and ${String(report.refunds)} refunds.`}
          </p>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}
          >
            {ORDER.filter((c) => report.counts[c] > 0).map((c) => (
              <div className="stat" key={c}>
                <div className="label">{LABELS[c]}</div>
                <div
                  className="value"
                  style={BAD.includes(c) ? { color: 'var(--danger)' } : undefined}
                >
                  {report.counts[c]}
                </div>
              </div>
            ))}
          </div>
          {report.problems.length ? (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.problems.map((p) => (
                    <tr key={p.sourceEventId}>
                      <td className="mono">{p.receiptNumber ?? p.billId ?? p.sourceEventId}</td>
                      <td>{p.eventType === 'SaleRefunded' ? 'Refund' : 'Sale'}</td>
                      <td style={BAD.includes(p.category) ? { color: 'var(--danger)' } : undefined}>
                        {p.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {report.ledgerMismatches.length ? (
            <>
              <h3>Stock taken does not match the recipe</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Recipe needs</th>
                      <th className="num">Stock taken</th>
                      <th>Bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.ledgerMismatches.map((m) => (
                      <tr key={`${m.saleConsumptionId}:${m.itemId}`}>
                        <td>{m.itemName}</td>
                        <td className="num">{Number(m.requiredBase)}</td>
                        <td className="num">{Number(m.postedBase)}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {m.billId ?? m.saleConsumptionId}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
