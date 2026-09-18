'use client';
import { reportCsv } from '@/server/report-csv';
import type { ReportRow } from '@/server/operational-reports';
export function ReportRows({
  title,
  rows,
  note,
}: {
  title: string;
  rows: ReportRow[] | null;
  note?: string;
}) {
  return (
    <section className="card" style={{ overflowX: 'auto', marginTop: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{title}</h2>
        {rows?.length ? (
          <button
            className="secondary sm"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([reportCsv(rows)], { type: 'text/csv;charset=utf-8' }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = `${title.toLowerCase().replaceAll(' ', '-')}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download CSV
          </button>
        ) : null}
      </div>
      {note ? <p className="muted">{note}</p> : null}
      {rows === null ? (
        <p>
          This report is unavailable for the selected scope. Choose all outlets for central
          purchasing reports.
        </p>
      ) : !rows.length ? (
        <p className="muted">No records in this period.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {Object.keys(rows[0] ?? {}).map((k) => (
                <th key={k}>{k.replaceAll('_', ' ')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <tr key={index}>
                {Object.entries(r).map(([k, v]) => (
                  <td key={k}>{v === null ? 'Not recorded' : String(v).replaceAll('_', ' ')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
