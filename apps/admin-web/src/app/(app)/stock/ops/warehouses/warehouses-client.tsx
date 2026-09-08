'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { WarehouseRow } from '@jksh/stock';
import { apiPost } from '../api';

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
          <div className="muted" style={{ fontSize: 12 }}>
            Code
          </div>
          <input value={code} onChange={(e) => setCode(e.target.value)} required maxLength={40} />
        </label>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Name
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
        </label>
        <button disabled={pending || !code.trim() || !name.trim()}>Create</button>
        {msg ? (
          <span className="muted" style={{ marginLeft: 8 }}>
            {msg}
          </span>
        ) : null}
      </form>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Timezone</th>
              <th>Locations</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td className="mono">{w.code}</td>
                <td>{w.name}</td>
                <td className="muted">{w.timezone}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {w.locations.map((l) => l.kind).join(', ') || '—'}
                </td>
                <td>{w.isActive ? 'yes' : 'no'}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No warehouses yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
