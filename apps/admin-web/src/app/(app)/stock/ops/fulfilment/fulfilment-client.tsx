'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { FulfilmentOrderRow } from '@jksh/stock';
import { DataTable, type Column } from '@/components/DataTable';
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

  const columns: Column<FulfilmentOrderRow>[] = [
    {
      key: 'order',
      header: 'Order',
      width: 'minmax(140px,1fr)',
      nowrap: true,
      sortValue: (o) => o.orderNumber,
      render: (o) => <span className="mono">{o.orderNumber}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '150px',
      sortValue: (o) => o.status,
      render: (o) => <span className={`pill ${o.status}`}>{o.status.replace('_', ' ')}</span>,
    },
    { key: 'lines', header: 'Lines', width: '70px', align: 'right', render: (o) => o.lines },
    {
      key: 'total',
      header: 'Total',
      width: '110px',
      align: 'right',
      sortValue: (o) => o.totalPaise,
      render: (o) => rupees(o.totalPaise),
    },
    {
      key: 'wh',
      header: 'Warehouse',
      width: '120px',
      render: (o) => (
        <select
          value={wh[o.id] ?? defaultWh}
          onChange={(e) => setWh({ ...wh, [o.id]: e.target.value })}
          style={{ margin: 0 }}
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'action',
      header: '',
      width: '120px',
      render: (o) => {
        const selected = wh[o.id] ?? defaultWh;
        if (o.status === 'paid')
          return (
            <button
              className="secondary sm"
              disabled={pending}
              onClick={() => void act(`/api/v1/stock/orders/${o.id}/approve`)}
            >
              Approve
            </button>
          );
        if (o.status === 'approved')
          return (
            <button
              className="secondary sm"
              disabled={pending || !selected}
              onClick={() =>
                void act(`/api/v1/stock/orders/${o.id}/allocate`, { warehouseId: selected })
              }
            >
              Allocate
            </button>
          );
        if ((o.status === 'allocated' || o.status === 'partially_dispatched') && selected)
          return (
            <button
              className="secondary sm"
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
          );
        return null;
      },
    },
  ];

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
      <DataTable
        columns={columns}
        rows={orders}
        rowKey={(o) => o.id}
        empty="Nothing awaiting fulfilment."
      />
    </div>
  );
}
