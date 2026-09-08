'use client';
import { useState } from 'react';
import type { RetentionStatus } from '@jksh/identity';

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

export function RetentionPanel({ status }: { status: RetentionStatus }) {
  const [from, setFrom] = useState(isoDaysAgo(status.activeWindowDays));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [busy, setBusy] = useState(false);

  function download(format: 'csv' | 'json') {
    setBusy(true);
    const url = `/api/v1/reports/export?from=${from}&to=${to}&format=${format}`;
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // The request also records a retention_exports row; refresh soon after.
    setTimeout(() => {
      setBusy(false);
      window.location.reload();
    }, 1200);
  }

  return (
    <>
      <h2 className="section-label">Retention &amp; export</h2>

      {status.expiringCount > 0 ? (
        <p className="error">
          {status.expiringCount} bill{status.expiringCount === 1 ? '' : 's'} on or before{' '}
          {status.expiringOnOrBefore} leave active history within about a week — export them now.
        </p>
      ) : null}

      <div className="card">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Bills stay in active POS history for {status.activeWindowDays} days. Export a range as a
          spreadsheet before it ages out — each export is logged with a content checksum.
          {status.oldestActiveDate ? ` Oldest bill on record: ${status.oldestActiveDate}.` : ''}
          {status.archivableCount > 0
            ? ` ${String(status.archivableCount)} bill(s) are already past the window.`
            : ''}
        </p>
        <div className="toolbar">
          <label>
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button disabled={busy || from > to} onClick={() => download('csv')}>
            Download CSV
          </button>
          <button
            className="secondary"
            disabled={busy || from > to}
            onClick={() => download('json')}
          >
            Full workbook (JSON)
          </button>
        </div>
      </div>

      {status.recentExports.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Range</th>
                <th>Kind</th>
                <th className="num">Bills</th>
                <th>Run at</th>
              </tr>
            </thead>
            <tbody>
              {status.recentExports.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.fromDate} → {e.toDate}
                  </td>
                  <td>
                    <span className="pill">{e.kind.replace('_', ' ')}</span>
                  </td>
                  <td className="num">{e.billCount}</td>
                  <td className="muted">{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
