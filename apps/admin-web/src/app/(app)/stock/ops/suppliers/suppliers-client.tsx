'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { SupplierRow } from '@jksh/stock';
import { apiPost } from '../api';

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

  return (
    <>
      <form
        className="card"
        onSubmit={create}
        style={{ display: 'flex', gap: 8, alignItems: 'end' }}
      >
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Name
          </div>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
        </label>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            GSTIN (optional)
          </div>
          <input value={gstin} onChange={(e) => setGstin(e.target.value)} maxLength={20} />
        </label>
        <button disabled={pending || !name.trim()}>Create</button>
        {msg ? (
          <span className="muted" style={{ marginLeft: 8 }}>
            {msg}
          </span>
        ) : null}
      </form>

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>GSTIN</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="mono">{s.gstin ?? '—'}</td>
              <td>
                <span className="pill">
                  {!s.isActive ? 'inactive' : s.isApproved ? 'approved' : 'pending'}
                </span>
              </td>
              <td>
                {!s.isApproved && s.isActive ? (
                  <button
                    className="secondary"
                    onClick={() => void approve(s.id)}
                    disabled={pending}
                  >
                    Approve
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No suppliers yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
