'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { WarehouseRow } from '@jksh/stock';
import { DataTable, type Column } from '@/components/DataTable';
import { apiPost } from '../api';

const columns: Column<WarehouseRow>[] = [
  {
    key: 'code',
    header: 'Code',
    width: '140px',
    nowrap: true,
    sortValue: (w) => w.code,
    render: (w) => <span className="mono">{w.code}</span>,
  },
  {
    key: 'name',
    header: 'Name',
    width: 'minmax(180px, 1fr)',
    nowrap: true,
    sortValue: (w) => w.name,
    render: (w) => w.name,
  },
  {
    key: 'tz',
    header: 'Timezone',
    width: '140px',
    render: (w) => <span className="muted">{w.timezone}</span>,
  },
  {
    key: 'loc',
    header: 'Locations',
    width: '120px',
    render: (w) => (
      <span className="muted" title={w.locations.map((l) => l.kind).join(', ')}>
        {w.locations.length} kinds
      </span>
    ),
  },
  {
    key: 'active',
    header: 'Active',
    width: '90px',
    sortValue: (w) => (w.isActive ? 1 : 0),
    render: (w) => (
      <span className={`pill ${w.isActive ? 'ok' : 'inactive'}`}>{w.isActive ? 'yes' : 'no'}</span>
    ),
  },
];

export function WarehousesClient({ rows }: { rows: WarehouseRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const r = await apiPost('/api/v1/stock/warehouses', { code: code.trim(), name: name.trim() });
    if (r.ok) {
      setCode('');
      setName('');
      setMsg('Warehouse created.');
      startTransition(() => router.refresh());
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  return (
    <>
      <form className="card toolbar" onSubmit={create}>
        <label>
          Code
          <input value={code} onChange={(e) => setCode(e.target.value)} required maxLength={40} />
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
        </label>
        <button disabled={pending || !code.trim() || !name.trim()}>Create</button>
        {msg ? (
          <span className="muted" style={{ marginLeft: 8 }}>
            {msg}
          </span>
        ) : null}
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(w) => w.id}
        initialSort={{ key: 'code', dir: 'asc' }}
        empty="No warehouses yet."
      />
    </>
  );
}
