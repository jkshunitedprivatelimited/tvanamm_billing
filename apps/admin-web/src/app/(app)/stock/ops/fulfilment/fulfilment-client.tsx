'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { FulfilmentOrderRow } from '@jksh/stock';
import { apiPost } from '../api';

interface Wh {
  id: string;
  code: string;
  name: string;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

export function FulfilmentClient({
  orders,
  warehouses,
}: {
  orders: FulfilmentOrderRow[];
  warehouses: Wh[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [wh, setWh] = useState<Record<string, string>>({});

  async function act(url: string, body?: unknown) {
    setMsg(null);
    const r = await apiPost(url, body);
    setMsg(r.ok ? 'Done.' : `Failed: ${r.error}`);
    startTransition(() => router.refresh());
  }

  const defaultWh = warehouses[0]?.id ?? '';

  return (
    <div className="card">
      {warehouses.length === 0 ? (
        <p className="error">No warehouses in scope — create one before allocating.</p>
      ) : null}
      {msg ? (
        <p className="muted" style={{ marginBottom: 8 }}>
          {msg}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>Lines</th>
            <th>Total</th>
            <th>Warehouse</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const selected = wh[o.id] ?? defaultWh;
            return (
              <tr key={o.id}>
                <td className="mono">{o.orderNumber}</td>
                <td>
                  <span className={`pill ${o.status}`}>{o.status}</span>
                </td>
                <td className="num">{o.lines}</td>
                <td className="num">{rupees(o.totalPaise)}</td>
                <td>
                  <select
                    value={selected}
                    onChange={(e) => setWh({ ...wh, [o.id]: e.target.value })}
                  >
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {o.status === 'paid' ? (
                    <button
                      className="secondary"
                      disabled={pending}
                      onClick={() => void act(`/api/v1/stock/orders/${o.id}/approve`)}
                    >
                      Approve
                    </button>
                  ) : null}
                  {o.status === 'approved' ? (
                    <button
                      className="secondary"
                      disabled={pending || !selected}
                      onClick={() =>
                        void act(`/api/v1/stock/orders/${o.id}/allocate`, { warehouseId: selected })
                      }
                    >
                      Allocate
                    </button>
                  ) : null}
                  {(o.status === 'allocated' || o.status === 'partially_dispatched') && selected ? (
                    <button
                      className="secondary"
                      disabled={pending}
                      onClick={() =>
                        void act(`/api/v1/stock/orders/${o.id}/dispatch`, {
                          warehouseId: selected,
                          dispatchNumber: `DSP-${o.orderNumber}-${Date.now().toString(36)}`,
                        })
                      }
                    >
                      Dispatch
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {orders.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                Nothing awaiting fulfilment.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
