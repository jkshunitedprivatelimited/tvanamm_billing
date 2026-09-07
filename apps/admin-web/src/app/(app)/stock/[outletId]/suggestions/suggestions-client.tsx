'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Row {
  id: string;
  itemName: string;
  suggestedQtyBase: string;
  status: string;
  inputs: unknown;
}

export function SuggestionsClient({ outletId, rows }: { outletId: string; rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  async function regenerate() {
    setMsg(null);
    const res = await fetch(`/api/v1/stock/outlets/${outletId}/suggestions`, { method: 'POST' });
    setMsg(res.ok ? 'Recalculated.' : 'Failed to recalculate.');
    startTransition(() => router.refresh());
  }

  async function dismiss(id: string) {
    const res = await fetch(`/api/v1/stock/suggestions/${id}/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    setMsg(res.ok ? 'Dismissed.' : 'Failed to dismiss.');
    startTransition(() => router.refresh());
  }

  return (
    <div className="card">
      <button onClick={regenerate} disabled={pending}>
        Recalculate
      </button>
      {msg ? (
        <span className="muted" style={{ marginLeft: 12 }}>
          {msg}
        </span>
      ) : null}
      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Suggested qty</th>
            <th>Status</th>
            <th>Why</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.itemName}</td>
              <td className="num">{r.suggestedQtyBase}</td>
              <td>
                <span className="pill">{r.status}</span>
              </td>
              <td className="mono" style={{ fontSize: 11, maxWidth: 320 }}>
                {JSON.stringify(r.inputs)}
              </td>
              <td>
                {r.status === 'open' ? (
                  <button
                    className="secondary"
                    onClick={() => void dismiss(r.id)}
                    disabled={pending}
                  >
                    Dismiss
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No suggestions. Recalculate after some sales history exists.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
