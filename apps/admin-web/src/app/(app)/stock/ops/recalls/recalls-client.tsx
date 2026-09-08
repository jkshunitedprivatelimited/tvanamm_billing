'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { RecallRow } from '@jksh/stock';
import { apiPost } from '../api';

export function RecallsClient({ rows }: { rows: RecallRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [itemId, setItemId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [reason, setReason] = useState('');

  async function draft(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await apiPost('/api/v1/stock/recalls', {
      itemId: itemId.trim(),
      batchId: batchId.trim(),
      reason: reason.trim(),
    });
    if (r.ok) {
      setItemId('');
      setBatchId('');
      setReason('');
      setMsg('Recall drafted.');
      startTransition(() => router.refresh());
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function act(id: string, verb: 'activate' | 'close') {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/recalls/${id}/${verb}`);
    setMsg(r.ok ? `${verb}d.` : `Failed: ${r.error}`);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <form className="card" onSubmit={draft}>
        <strong>Draft a recall</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 8, flexWrap: 'wrap' }}>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Item id
            </div>
            <input value={itemId} onChange={(e) => setItemId(e.target.value)} required />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Batch id
            </div>
            <input value={batchId} onChange={(e) => setBatchId(e.target.value)} required />
          </label>
          <label style={{ flex: 1 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Reason
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={300}
              style={{ width: '100%' }}
            />
          </label>
          <button disabled={pending || !itemId.trim() || !batchId.trim() || !reason.trim()}>
            Draft
          </button>
        </div>
        {msg ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {msg}
          </p>
        ) : null}
      </form>

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Batch</th>
            <th>Status</th>
            <th>Identified</th>
            <th>Quarantined</th>
            <th>Reason</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.itemName}</td>
              <td className="mono">{r.batchCode}</td>
              <td>
                <span className={`pill ${r.status}`}>{r.status}</span>
              </td>
              <td className="num">{r.identifiedBase}</td>
              <td className="num">{r.quarantinedBase}</td>
              <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>
                {r.reason}
              </td>
              <td style={{ display: 'flex', gap: 6 }}>
                {r.status === 'draft' ? (
                  <button
                    className="secondary"
                    disabled={pending}
                    onClick={() => void act(r.id, 'activate')}
                  >
                    Activate
                  </button>
                ) : null}
                {r.status === 'active' ? (
                  <button
                    className="secondary"
                    disabled={pending}
                    onClick={() => void act(r.id, 'close')}
                  >
                    Close
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                No recalls.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
