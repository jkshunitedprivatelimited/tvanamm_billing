'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';

interface CatalogItem {
  id: string;
  itemId: string;
  name: string;
  sku: string;
  baseUnit: string;
  orderPackBase: string;
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
    const timer = window.setTimeout(() => resolve(null), 15000);
    const onReady = () => {
      window.clearTimeout(timer);
      resolve(w.Razorpay ?? null);
    };
    const onError = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    if (existing) {
      existing.addEventListener('load', onReady, { once: true });
      existing.addEventListener('error', onError, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.addEventListener('load', onReady, { once: true });
    s.addEventListener(
      'error',
      () => {
        s.remove();
        onError();
      },
      { once: true },
    );
    document.body.appendChild(s);
  });
}

export function OrderClient({
  outletId,
  catalog,
  initialItemId,
  initialQty,
  initialOrder,
}: {
  outletId: string;
  catalog: CatalogItem[];
  /** Arrived here from a reorder suggestion's "Convert to order" link —
   *  pre-fill that one item's quantity so it just needs a review + confirm. */
  initialItemId?: string;
  initialQty?: string;
  initialOrder?: {
    id: string;
    totalPaise: number;
    status: string;
    quantities: Record<string, string>;
  };
}) {
  const [qty, setQty] = useState<Record<string, string>>(() => {
    if (initialOrder) return initialOrder.quantities;
    if (!initialItemId || !initialQty) return {};
    const match = catalog.find((c) => c.itemId === initialItemId);
    return match ? { [match.id]: initialQty } : {};
  });
  const orderReference = useRef<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [order, setOrder] = useState<{ id: string; totalPaise: number } | null>(
    initialOrder ?? null,
  );
  const [orderStatus, setOrderStatus] = useState<string | null>(initialOrder?.status ?? null);

  const razorpayKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

  const lines = useMemo(
    () => catalog.map((c) => ({ item: c, qty: Number(qty[c.id] ?? '0') })).filter((l) => l.qty > 0),
    [catalog, qty],
  );
  const visibleCatalog = catalog.filter((c) =>
    `${c.name} ${c.sku}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const invalidQuantity = Object.values(qty).some(
    (value) => value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0),
  );
  const canPay =
    !orderStatus || ['draft', 'awaiting_payment', 'payment_pending'].includes(orderStatus);
  const estimatePaise = lines.reduce((s, l) => s + l.qty * l.item.pricePaise, 0);

  async function createOrder() {
    if (busy || order || invalidQuantity || lines.length === 0) return;
    orderReference.current ??= `SO-${crypto.randomUUID()}`;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/v1/stock/outlets/${outletId}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderNumber: orderReference.current,
          lines: lines.map((l) => ({ supplyCatalogItemId: l.item.id, qtyBase: String(l.qty) })),
        }),
      });
      const body = (await res.json()) as {
        id: string;
        totalPaise: number;
        message?: string;
        razorpayOrderId: string;
        amountPaise: number;
        status?: string;
      };
      if (!res.ok) {
        setStatus(`Error: ${body.message ?? 'The request could not be completed. Please retry.'}`);
        return;
      }
      const o = body as { id: string; totalPaise: number };
      setOrder(o);
      window.history.replaceState(
        null,
        '',
        `/stock/${outletId}/order?order=${encodeURIComponent(o.id)}`,
      );
      setStatus(`Draft order created — total ₹${(o.totalPaise / 100).toFixed(2)}`);
    } catch {
      setStatus(
        'Error: Connection interrupted. Check the order or payment status before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus(orderId: string): Promise<string> {
    const res = await fetch(`/api/v1/stock/orders/${orderId}`);
    if (!res.ok) throw new Error('Could not retrieve payment status');
    const body = (await res.json()) as { status?: string };
    return body.status ?? 'unknown';
  }

  async function pay() {
    if (!order || busy) return;
    setBusy(true);
    try {
      if (!razorpayKeyId) {
        setStatus(
          'Error: Online payment is not configured. Your order is saved; contact central support.',
        );
        return;
      }
      const res = await fetch(`/api/v1/stock/orders/${order.id}/pay`, { method: 'POST' });
      const body = (await res.json()) as {
        id: string;
        totalPaise: number;
        message?: string;
        razorpayOrderId: string;
        amountPaise: number;
        status?: string;
      };
      if (!res.ok) {
        setStatus(`Error: ${body.message ?? 'The request could not be completed. Please retry.'}`);
        return;
      }
      const p = body as { razorpayOrderId: string; amountPaise: number };

      if (!razorpayKeyId) {
        setStatus(
          'Error: Online payment is not configured for this workspace. Contact JKSH support. Your draft is saved.',
        );
        return;
      }

      const Razorpay = await loadCheckout();
      if (!Razorpay) {
        setStatus('Error: Payment checkout could not load. Check your connection and retry.');
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
              setStatus(
                'Error: Payment confirmation is pending. Use Check payment status before trying to pay again.',
              );
              return;
            }
            const s = await refreshStatus(order.id);
            setOrderStatus(s);
            setStatus(
              s === 'paid'
                ? 'Payment captured — order is paid.'
                : `Payment recorded (status: ${s}). If the automatic webhook is delayed, use "Check payment status" below.`,
            );
          })().catch(() =>
            setStatus(
              'Error: Payment confirmation was interrupted. Use Check payment status before trying to pay again.',
            ),
          );
        },
        modal: { ondismiss: () => setStatus('Payment cancelled.') },
      });
      rzp.open();
      setStatus('Razorpay Checkout opened…');
    } catch {
      setStatus(
        'Error: Connection interrupted. Check the order or payment status before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkPaymentStatus() {
    if (!order || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/stock/orders/${order.id}/reconcile`, { method: 'POST' });
      const body = (await res.json()) as {
        id: string;
        totalPaise: number;
        message?: string;
        razorpayOrderId: string;
        amountPaise: number;
        status?: string;
      };
      if (!res.ok) {
        setStatus(
          `Error: ${body.message ?? 'Payment status is unavailable. Please try again shortly.'}`,
        );
        return;
      }
      const s = (body as { status?: string }).status ?? (await refreshStatus(order.id));
      setOrderStatus(s);
      setStatus(
        s === 'paid'
          ? 'Payment captured — order is paid.'
          : `Payment has not been confirmed yet (status: ${s}). Try again shortly, or contact JKSH if this persists.`,
      );
    } catch {
      setStatus(
        'Error: Connection interrupted. Check the order or payment status before retrying.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="workspace-heading">
        <div>
          <h2>{order ? (canPay ? 'Complete payment' : 'Order summary') : 'Choose supplies'}</h2>
          <p className="muted">Enter quantities in the unit shown for each item.</p>
        </div>
        <label>
          Find supplies
          <input
            type="search"
            placeholder="Search name or SKU"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Price (incl. GST)</th>
              <th>GST %</th>
              <th style={{ width: 100 }}>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {visibleCatalog.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  <div className="muted">
                    {c.sku} · Order pack: {c.orderPackBase} {c.baseUnit}
                  </div>
                </td>
                <td className="num">
                  ₹{(c.pricePaise / 100).toFixed(2)} / {c.baseUnit}
                </td>
                <td className="num">{c.gstRate}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    aria-label={`Quantity of ${c.name} in ${c.baseUnit}`}
                    disabled={busy || !!order}
                    value={qty[c.id] ?? ''}
                    onChange={(e) => setQty((q) => ({ ...q, [c.id]: e.target.value }))}
                    placeholder="0"
                    style={{ margin: 0 }}
                  />
                </td>
              </tr>
            ))}
            {visibleCatalog.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  {catalog.length === 0
                    ? 'No supplies are available for this outlet yet.'
                    : 'No supplies match your search.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {invalidQuantity ? (
        <p className="error" role="alert">
          Enter a valid quantity of zero or more.
        </p>
      ) : null}
      <div className="order-summary">
        <div>
          <strong>
            {order ? 'Order total' : 'Items estimate'}: ₹
            {((order?.totalPaise ?? estimatePaise) / 100).toFixed(2)}
          </strong>
          <div className="muted">
            {lines.length} item type(s) ·{' '}
            {order
              ? 'Quantities locked for this order'
              : 'Delivery charges confirmed when you create the order'}
          </div>
        </div>
        {!order ? (
          <button onClick={createOrder} disabled={busy || invalidQuantity || lines.length === 0}>
            {busy ? 'Creating order…' : 'Review final total'}
          </button>
        ) : null}
        {order && canPay ? (
          <button className="secondary" onClick={pay} disabled={busy}>
            Pay with Razorpay
          </button>
        ) : null}
        {order && canPay ? (
          <button className="ghost" onClick={checkPaymentStatus} disabled={busy}>
            Check payment status
          </button>
        ) : null}
      </div>

      {orderStatus ? <p className="muted">Status: {orderStatus.replaceAll('_', ' ')}</p> : null}
      <p>
        <Link href={`/stock/${outletId}/orders`}>View order history & delivery progress →</Link>
      </p>
      {status ? (
        <p
          role="status"
          className={status.startsWith('Error') ? 'error' : 'ok'}
          style={{ marginTop: 12 }}
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
