'use client';
import { useMemo, useState } from 'react';

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  pricePaise: number;
  gstRate: string;
}

interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open: () => void;
}
type RazorpayCtor = new (options: Record<string, unknown>) => RazorpayInstance;

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadCheckout(): Promise<RazorpayCtor | null> {
  return new Promise((resolve) => {
    const w = window as unknown as { Razorpay?: RazorpayCtor };
    if (w.Razorpay) {
      resolve(w.Razorpay);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const onReady = () => resolve(w.Razorpay ?? null);
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.addEventListener('load', onReady, { once: true });
    s.addEventListener('error', () => resolve(null), { once: true });
    document.body.appendChild(s);
  });
}

export function OrderClient({ outletId, catalog }: { outletId: string; catalog: CatalogItem[] }) {
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [order, setOrder] = useState<{ id: string; totalPaise: number } | null>(null);

  const razorpayKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

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

  async function refreshStatus(orderId: string): Promise<string> {
    const res = await fetch(`/api/v1/stock/orders/${orderId}`);
    const body = (await res.json()) as { status?: string };
    return body.status ?? 'unknown';
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
      const p = body as { razorpayOrderId: string; amountPaise: number };

      if (!razorpayKeyId) {
        setStatus(
          `Razorpay order ${p.razorpayOrderId} created for ₹${(p.amountPaise / 100).toFixed(2)}. ` +
            `Set NEXT_PUBLIC_RAZORPAY_KEY_ID to open Checkout; the order becomes "paid" only after the verified webhook.`,
        );
        return;
      }

      const Razorpay = await loadCheckout();
      if (!Razorpay) {
        setStatus('Could not load Razorpay Checkout.');
        return;
      }
      const rzp = new Razorpay({
        key: razorpayKeyId,
        order_id: p.razorpayOrderId,
        amount: p.amountPaise,
        currency: 'INR',
        name: 'JKSH',
        description: 'Outlet stock order',
        handler: (response: RazorpayCheckoutResponse) => {
          void (async () => {
            const cb = await fetch(`/api/v1/stock/orders/${order.id}/checkout-callback`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            if (!cb.ok) {
              setStatus(`Callback rejected: ${JSON.stringify(await cb.json())}`);
              return;
            }
            const s = await refreshStatus(order.id);
            setStatus(
              s === 'paid'
                ? 'Payment captured — order is paid.'
                : `Payment recorded (status: ${s}); it becomes "paid" once the signed webhook is reconciled.`,
            );
          })();
        },
        modal: { ondismiss: () => setStatus('Payment cancelled.') },
      });
      rzp.open();
      setStatus('Razorpay Checkout opened…');
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
            Pay with Razorpay
          </button>
        ) : null}
      </div>

      {status ? (
        <p className={status.startsWith('Error') ? 'error' : 'ok'} style={{ marginTop: 12 }}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
