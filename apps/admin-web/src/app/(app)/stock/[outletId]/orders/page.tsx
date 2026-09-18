import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { listOutlets } from '@jksh/identity';
import { listOutletOrders, getStockOrder } from '@jksh/stock';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';

export const dynamic = 'force-dynamic';
const stages: Record<string, [string, string]> = {
  draft: ['Draft', 'Review the total and complete payment when ready.'],
  awaiting_payment: [
    'Awaiting payment',
    'Your order is saved. Complete payment to send it for fulfilment.',
  ],
  payment_pending: [
    'Confirming payment',
    'Check payment status before attempting another payment.',
  ],
  paid: ['Payment received', 'Central will prepare your order.'],
  approved: ['Order approved', 'The warehouse is preparing your supplies.'],
  allocated: ['Stock reserved', 'Your supplies are reserved for dispatch.'],
  packed: ['Packed', 'Your order is ready to leave the warehouse.'],
  partially_dispatched: [
    'Partly dispatched',
    'Some supplies have left the warehouse. The remaining quantities are still pending.',
  ],
  dispatched: ['On the way', 'Confirm the quantities when your delivery arrives.'],
  partially_received: [
    'Partly received',
    'Some quantities have been received. Check remaining deliveries and differences.',
  ],
  received: ['Delivery received', 'Review any differences before closing the order.'],
  closed: ['Completed', 'This order is closed.'],
  cancelled: ['Cancelled', 'This order will not be fulfilled.'],
  expired: ['Expired', 'Create a new order if you still need these supplies.'],
  failed: ['Payment failed', 'Contact central support if money was deducted.'],
};
const money = (n: number) => `₹${(n / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ outletId: string }>;
  searchParams: Promise<{ before?: string; order?: string }>;
}) {
  const { outletId } = await params;
  const sp = await searchParams;
  for (const id of [sp.before, sp.order]) if (id && !z.uuid().safeParse(id).success) notFound();
  const actor = await requireAdminActor();
  const outlet = (await listOutlets(db(), actor)).find((o) => o.id === outletId);
  if (!outlet) notFound();
  const stockActor = await stockActorFor(actor, { outletId });
  const [history, detail] = await Promise.all([
    listOutletOrders(stockDb(), stockActor, outletId, sp.before),
    sp.order ? getStockOrder(stockDb(), stockActor, sp.order) : null,
  ]);
  if (detail && detail.outletId !== outletId) notFound();
  const base = `/stock/${outletId}`;
  return (
    <main>
      <p>
        <Link href={base}>← Stock overview</Link>
      </p>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">{outlet.displayName}</p>
          <h1>Orders & deliveries</h1>
          <p className="page-intro">
            Find saved orders, follow deliveries and review what you received.
          </p>
        </div>
        <Link className="btn" href={`${base}/order`}>
          Order supplies
        </Link>
      </div>
      {detail ? (
        <section className="card" aria-labelledby="order-detail-title">
          <div className="workspace-heading">
            <h2 id="order-detail-title">{detail.orderNumber}</h2>
            <Link href={`${base}/orders`}>Close details</Link>
          </div>
          <strong>{stages[detail.status]?.[0] ?? detail.status}</strong>
          <p className="muted">{stages[detail.status]?.[1]}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Supply</th>
                  <th>Ordered</th>
                  <th>Dispatched</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.supplyCatalogItemId}>
                    <td>{l.itemName}</td>
                    <td>
                      {Number(l.qtyBase)} {l.baseUnit}
                    </td>
                    <td>
                      {Number(l.dispatchedQtyBase)} {l.baseUnit}
                    </td>
                    <td>
                      {Number(l.receivedQtyBase)} {l.baseUnit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Items {money(detail.subtotalPaise)} · GST {money(detail.taxPaise)} · Delivery{' '}
            {money(detail.deliveryPaise)}
          </p>
          <p>
            <strong>Total {money(detail.totalPaise)}</strong>
          </p>
          {['draft', 'awaiting_payment', 'payment_pending'].includes(detail.status) ? (
            <Link className="btn" href={`${base}/order?order=${detail.id}`}>
              Review order & payment
            </Link>
          ) : null}
          {['partially_dispatched', 'dispatched', 'partially_received', 'received'].includes(
            detail.status,
          ) ? (
            <Link className="btn" href={`${base}/receiving`}>
              Manage delivery
            </Link>
          ) : null}
        </section>
      ) : null}
      <section aria-label="Order history" className="stock-order-history">
        {history.orders.length === 0 ? (
          <div className="card">
            <h2>{sp.before ? 'No older orders' : 'Your orders will appear here'}</h2>
            <p className="muted">
              Saved drafts, payments and delivery progress are kept together for this outlet.
            </p>
          </div>
        ) : null}
        {history.orders.map((o) => (
          <Link className="stock-order-row card" href={`${base}/orders?order=${o.id}`} key={o.id}>
            <div>
              <strong>{o.orderNumber}</strong>
              <p className="muted">
                {new Date(o.createdAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Kolkata',
                })}{' '}
                IST
              </p>
            </div>
            <span className="badge">{stages[o.status]?.[0] ?? o.status}</span>
            <strong>{money(o.totalPaise)}</strong>
            <span>View details →</span>
          </Link>
        ))}
      </section>
      <div className="toolbar">
        {sp.before ? <Link href={`${base}/orders`}>Latest orders</Link> : null}
        {history.next ? (
          <Link href={`${base}/orders?before=${history.next}`}>Older orders →</Link>
        ) : null}
      </div>
    </main>
  );
}
