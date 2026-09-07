'use client';
import { useMemo, useState } from 'react';

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  pricePaise: number;
  gstRate: string;
}

export function OrderClient({ outletId, catalog }: { outletId: string; catalog: CatalogItem[] }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [order, setOrder] = useState<{ id: string; totalPaise: number } | null>(null);
  const [payment, setPayment] = useState<string | null>(null);

  const lines = useMemo(
    () => catalog.map((c) => ({ item: c, qty: Number(qty[c.id] ?? '0') })).filter((l) => l.qty > 0),
    [catalog, qty],
  );
  const estimatePaise = lines.reduce((s, l) => s + l.qty * l.item.pricePaise, 0);

  async function createOrder() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/v1/stock/outlets/${outletId}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNumber: `SO-${Date.now().toString(36).toUpperCase()}`,
          lines: lines.map((l) => ({ supplyCatalogItemId: l.item.id, qtyBase: String(l.qty) })),
        }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${JSON.stringify(body)}`);
        return;
      }
      const o = body as { id: string; totalPaise: number };
      setOrder(o);
      setStatus(`Draft order created — total ₹${(o.totalPaise / 100).toFixed(2)}`);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!order) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/stock/orders/${order.id}/pay`, { method: 'POST' });
      const body: unknown = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${JSON.stringify(body)}`);
        return;
      }
      const p = body as { razorpayOrderId: string; amountPaise: number; status: string };
      setPayment(p.razorpayOrderId);
      setStatus(
        `Razorpay order ${p.razorpayOrderId} created for ₹${(p.amountPaise / 100).toFixed(2)}. ` +
          `Complete Razorpay Checkout; the order becomes "paid" only after the signed webhook is verified.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Price (incl. GST)</th>
            <th>GST %</th>
            <th style={{ width: 100 }}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {catalog.map((c) => (
            <tr key={c.id}>
              <td>
                {c.name} <span className="muted">· {c.sku}</span>
              </td>
              <td className="num">₹{(c.pricePaise / 100).toFixed(2)}</td>
              <td className="num">{c.gstRate}</td>
              <td>
                <input
                  inputMode="numeric"
                  value={qty[c.id] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [c.id]: e.target.value }))}
                  placeholder="0"
                  style={{ margin: 0 }}
                />
              </td>
            </tr>
          ))}
          {catalog.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No catalog items available for this outlet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
        <strong>Estimate: ₹{(estimatePaise / 100).toFixed(2)}</strong>
        <button onClick={createOrder} disabled={busy || lines.length === 0}>
          Create draft order
        </button>
        {order ? (
          <button className="secondary" onClick={pay} disabled={busy}>
            Submit for payment
          </button>
        ) : null}
      </div>

      {status ? (
        <p className={status.startsWith('Error') ? 'error' : 'ok'} style={{ marginTop: 12 }}>
          {status}
        </p>
      ) : null}
      {payment ? (
        <p className="muted mono" style={{ fontSize: 12 }}>
          razorpay_order_id: {payment}
        </p>
      ) : null}
    </div>
  );
}
