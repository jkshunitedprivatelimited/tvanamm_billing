'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
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
  outlets,
}: {
  orders: FulfilmentOrderRow[];
  outlets: { id: string; name: string }[];
  warehouses: Wh[];
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const pending = saving || refreshing;
  const [msg, setMsg] = useState<string | null>(null);
  const [wh, setWh] = useState<Record<string, string>>({});

  async function act(url: string, body?: unknown) {
    if (busy.current || pending) return;
    busy.current = true;
    setSaving(true);
    setMsg(null);
    try {
      const r = await apiPost(url, body);
      setMsg(r.ok ? 'Done.' : `Failed: ${r.error}`);
      startTransition(() => router.refresh());
    } catch {
      setMsg('Connection interrupted. Refresh the order before retrying.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const defaultWh = warehouses[0]?.id ?? '';

  function cancelAndRefund(o: FulfilmentOrderRow) {
    const reason = window
      .prompt(
        `Cancel ${o.orderNumber} and refund ${rupees(o.totalPaise)} to the owner? Enter the reason:`,
      )
      ?.trim();
    if (!reason) return;
    void act(`/api/v1/stock/orders/${o.id}/cancel`, {
      submissionId: crypto.randomUUID(),
      reason,
    });
  }

  const columns: Column<FulfilmentOrderRow>[] = [
    {
      key: 'shipping',
      header: 'Shipping',
      render: (o) => {
        const selected = wh[o.id] ?? defaultWh;
        return selected &&
          ['paid', 'approved', 'allocated', 'partially_dispatched'].includes(o.status) ? (
          <Link href={`/stock/ops/fulfilment/${o.id}/shipping?warehouseId=${selected}`}>
            Prepare delivery
          </Link>
        ) : (
          <span>—</span>
        );
      },
    },
    {
      key: 'outlet',
      header: 'Outlet',
      render: (o) => (
        <strong>
          {outlets.find((outlet) => outlet.id === o.outletId)?.name ?? 'Outlet unavailable'}
        </strong>
      ),
    },
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
      render: (o) => <span className={`pill ${o.status}`}>{o.status.replaceAll('_', ' ')}</span>,
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
              {w.name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'action',
      header: '',
      width: '190px',
      render: (o) => {
        const selected = wh[o.id] ?? defaultWh;
        const refund = (
          <button className="ghost sm" disabled={pending} onClick={() => cancelAndRefund(o)}>
            Cancel &amp; refund
          </button>
        );
        if (o.status === 'paid')
          return (
            <>
              <button
                className="secondary sm"
                disabled={pending}
                onClick={() => void act(`/api/v1/stock/orders/${o.id}/approve`)}
              >
                Approve
              </button>
              {refund}
            </>
          );
        if (o.status === 'approved')
          return (
            <>
              <button
                className="secondary sm"
                disabled={pending || !selected}
                onClick={() =>
                  void act(`/api/v1/stock/orders/${o.id}/allocate`, { warehouseId: selected })
                }
              >
                Allocate
              </button>
              {refund}
            </>
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

  if (!orders.length)
    return (
      <section className="empty-workspace">
        <h2>No orders waiting for delivery</h2>
        <p>
          Paid orders from your outlets will appear here. Set up your real items, prices and
          warehouse to begin supplying them.
        </p>
        <Link href="/stock/ops/catalog">Set up items &amp; prices →</Link>
      </section>
    );
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
