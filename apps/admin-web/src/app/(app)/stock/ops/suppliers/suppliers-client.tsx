'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { SupplierRow } from '@jksh/stock';
import { DataTable, type Column } from '@/components/DataTable';
import { apiPost } from '../api';

function statusOf(s: SupplierRow): string {
  return !s.isActive ? 'inactive' : s.isApproved ? 'approved' : 'pending';
}

export function SuppliersClient({ rows }: { rows: SupplierRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body: Record<string, unknown> = { name: name.trim() };
    if (gstin.trim()) body.gstin = gstin.trim();
    const r = await apiPost('/api/v1/stock/suppliers', body);
    if (r.ok) {
      setName('');
      setGstin('');
      setMsg('Supplier created (pending approval).');
      startTransition(() => router.refresh());
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function approve(id: string) {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/suppliers/${id}/approve`);
    setMsg(r.ok ? 'Approved.' : `Failed: ${r.error}`);
    startTransition(() => router.refresh());
  }

  const columns: Column<SupplierRow>[] = [
    {
      key: 'name',
      header: 'Name',
      width: 'minmax(200px, 1fr)',
      nowrap: true,
      sortValue: (s) => s.name,
      render: (s) => s.name,
    },
    {
      key: 'gstin',
      header: 'GSTIN',
      width: '180px',
      render: (s) => <span className="mono">{s.gstin ?? '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      sortValue: (s) => statusOf(s),
      render: (s) => <span className={`pill ${statusOf(s)}`}>{statusOf(s)}</span>,
    },
    {
      key: 'action',
      header: '',
      width: '110px',
      render: (s) =>
        !s.isApproved && s.isActive ? (
          <button className="secondary sm" onClick={() => void approve(s.id)} disabled={pending}>
            Approve
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <form className="card toolbar" onSubmit={create}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
        <label>
          GSTIN (optional)
          <input value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={20} />
        </label>
        <button disabled={pending || !name.trim()}>Create</button>
        {msg ? (
          <span className="muted" style={{ marginLeft: 8 }}>
            {msg}
          </span>
        ) : null}
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        initialSort={{ key: 'name', dir: 'asc' }}
        empty="No suppliers yet."
      />
    </>
  );
}
