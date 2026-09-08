'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { RecallRow } from '@jksh/stock';
import { DataTable, type Column } from '@/components/DataTable';
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

  const columns: Column<RecallRow>[] = [
    {
      key: 'item',
      header: 'Item',
      width: 'minmax(140px,1fr)',
      nowrap: true,
      sortValue: (r) => r.itemName,
      render: (r) => r.itemName,
    },
    {
      key: 'batch',
      header: 'Batch',
      width: '120px',
      nowrap: true,
      render: (r) => <span className="mono">{r.batchCode}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      sortValue: (r) => r.status,
      render: (r) => <span className={`pill ${r.status}`}>{r.status}</span>,
    },
    {
      key: 'ident',
      header: 'Identified',
      width: '100px',
      align: 'right',
      render: (r) => r.identifiedBase,
    },
    {
      key: 'quar',
      header: 'Quarantined',
      width: '110px',
      align: 'right',
      render: (r) => r.quarantinedBase,
    },
    {
      key: 'reason',
      header: 'Reason',
      width: 'minmax(140px,1.4fr)',
      nowrap: true,
      render: (r) => r.reason,
    },
    {
      key: 'action',
      header: '',
      width: '100px',
      render: (r) =>
        r.status === 'draft' ? (
          <button
            className="secondary sm"
            disabled={pending}
            onClick={() => void act(r.id, 'activate')}
          >
            Activate
          </button>
        ) : r.status === 'active' ? (
          <button
            className="secondary sm"
            disabled={pending}
            onClick={() => void act(r.id, 'close')}
          >
            Close
          </button>
        ) : null,
    },
  ];

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

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        initialSort={{ key: 'status', dir: 'asc' }}
        empty="No recalls."
      />
    </>
  );
}
