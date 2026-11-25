/**
 * Cancelling stock orders and refunding prepayments (stock migration 0027)
 * against a real Postgres with the in-process Razorpay stub: unpaid cancel,
 * paid cancel + refund, retry safety across an outage, webhook settlement, and
 * a payment captured after cancellation. Runs only when STOCK_DATABASE_URL is set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, configureOutletStock } from './inventory';
import { publishCatalogItem } from './supply-catalog';
import {
  confirmCheckoutCallback,
  createStockOrder,
  getStockOrder,
  handleRazorpayWebhook,
  reconcileStockOrderPayment,
  submitStockOrderForPayment,
} from './stock-orders';
import { cancelStockOrder, listStockOrderRefunds } from './order-refunds';
import {
  signCheckout,
  signWebhook,
  stubRazorpayGateway,
  type RazorpayPayment,
  type RazorpayRefund,
} from './razorpay';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = randomUUID();
const OUTLET = randomUUID();
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let owner: StockActor;
let central: StockActor;
let catalogItemId: string;
const payments = new Map<string, RazorpayPayment>();
const refunds = new Map<string, RazorpayRefund>();
const failRefunds = { remaining: 0 };
const gateway = stubRazorpayGateway({
  keySecret: 'k',
  webhookSecret: 'w',
  payments,
  refunds,
  failRefunds,
});

async function newOrder(qty = '10') {
  return createStockOrder(pool, owner, {
    organizationId: ORG,
    outletId: OUTLET,
    franchiseId: FRANCHISE,
    orderNumber: `RF-${randomUUID().slice(0, 8)}`,
    lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: qty }],
  });
}

async function paidOrder() {
  const order = await newOrder();
  const sub = await submitStockOrderForPayment(pool, owner, order.id, gateway);
  const paymentId = `pay_${randomUUID().slice(0, 8)}`;
  await confirmCheckoutCallback(
    pool,
    owner,
    {
      orderId: order.id,
      razorpayPaymentId: paymentId,
      razorpaySignature: signCheckout(sub.razorpayOrderId, paymentId, 'k'),
    },
    gateway,
  );
  payments.set(paymentId, {
    id: paymentId,
    order_id: sub.razorpayOrderId,
    amount: sub.amountPaise,
    currency: 'INR',
    status: 'captured',
  });
  expect((await reconcileStockOrderPayment(pool, owner, order.id, gateway)).status).toBe('paid');
  return { order, paymentId, amount: sub.amountPaise, rzpOrderId: sub.razorpayOrderId };
}

function refundWebhook(event: string, refund: RazorpayRefund) {
  const body = JSON.stringify({ id: `evt_${randomUUID()}` });
  return {
    eventId: `evt_${randomUUID()}`,
    eventType: event,
    rawBody: body,
    signature: signWebhook(body, 'w'),
    payload: {
      event,
      payload: {
        refund: {
          entity: {
            id: refund.id,
            payment_id: refund.payment_id,
            amount: refund.amount,
            notes: { jksh_refund_id: refund.refundRef },
          },
        },
      },
    },
  };
}

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);
  owner = {
    request: 'admin',
    role: 'franchise_owner',
    accountId: randomUUID(),
    organizationId: ORG,
    franchiseId: FRANCHISE,
    warehouseIds: [],
  };
  central = {
    request: 'admin',
    role: 'central_admin',
    accountId: randomUUID(),
    organizationId: ORG,
    warehouseIds: [],
  };
  const item = await createItem(pool, sys, {
    organizationId: ORG,
    sku: `RF-CUP-${S}`,
    name: 'Refund Cup',
    itemType: 'packaging',
    dimension: 'count',
    baseUnit: 'each',
    supplyRule: 'jksh_required',
  });
  catalogItemId = (
    await publishCatalogItem(pool, sys, {
      organizationId: ORG,
      itemId: item.id,
      gstInclusivePricePaise: 1000,
      gstRate: 5,
      hsnCode: '4823',
    })
  ).id;
  await configureOutletStock(pool, sys, {
    outletId: OUTLET,
    organizationId: ORG,
    franchiseId: FRANCHISE,
  });
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Stock order cancellation and refunds', () => {
  it('lets the owner cancel an unpaid order with no money movement', async () => {
    const order = await newOrder();
    const res = await cancelStockOrder(
      pool,
      owner,
      order.id,
      { submissionId: randomUUID(), reason: 'Ordered by mistake' },
      gateway,
    );
    expect(res).toMatchObject({ status: 'cancelled', refund: null });
    expect((await getStockOrder(pool, owner, order.id)).status).toBe('cancelled');
    const other: StockActor = { ...owner, franchiseId: randomUUID() };
    const second = await newOrder();
    await expect(
      cancelStockOrder(
        pool,
        other,
        second.id,
        { submissionId: randomUUID(), reason: 'x' },
        gateway,
      ),
    ).rejects.toThrow(/not found/);
  });

  it('refunds a paid order once, even when the same request is retried', async () => {
    const { order, paymentId, amount } = await paidOrder();
    await expect(
      cancelStockOrder(pool, owner, order.id, { submissionId: randomUUID(), reason: 'x' }, gateway),
    ).rejects.toThrow(/Ask Central/);

    const request = { submissionId: randomUUID(), reason: 'Outlet closed for renovation' };
    const res = await cancelStockOrder(pool, central, order.id, request, gateway);
    expect(res.refund).toMatchObject({ status: 'pending', amountPaise: amount });
    const again = await cancelStockOrder(pool, central, order.id, request, gateway);
    expect(again.duplicate).toBe(true);
    // A different request for the same order still reuses the live refund.
    await cancelStockOrder(
      pool,
      central,
      order.id,
      { submissionId: randomUUID(), reason: 'y' },
      gateway,
    );
    expect([...refunds.values()].filter((r) => r.payment_id === paymentId)).toHaveLength(1);

    // Razorpay confirms; a replayed webhook changes nothing.
    const created = [...refunds.values()].find((r) => r.payment_id === paymentId);
    expect(created).toBeDefined();
    if (!created) return;
    const hook = refundWebhook('refund.processed', created);
    expect(await handleRazorpayWebhook(pool, hook, gateway)).toMatchObject({ processed: true });
    expect(await handleRazorpayWebhook(pool, hook, gateway)).toMatchObject({ duplicate: true });
    const [row] = await listStockOrderRefunds(pool, central, order.id);
    expect(row).toMatchObject({ status: 'processed', razorpayRefundId: created.id });
    const pay = await pool.query<{ status: string }>(
      'select status::text from stock.stock_order_payments where razorpay_payment_id = $1',
      [paymentId],
    );
    expect(pay.rows[0]?.status).toBe('refunded');
    // A late "failed" webhook cannot undo a processed refund.
    await handleRazorpayWebhook(pool, refundWebhook('refund.failed', created), gateway);
    expect((await listStockOrderRefunds(pool, central, order.id))[0]?.status).toBe('processed');
  });

  it('survives a Razorpay outage and a lost response without refunding twice', async () => {
    const { order, paymentId } = await paidOrder();
    failRefunds.remaining = 1;
    const request = { submissionId: randomUUID(), reason: 'Duplicate order' };
    await expect(cancelStockOrder(pool, central, order.id, request, gateway)).rejects.toThrow(
      /could not be started/,
    );
    expect((await getStockOrder(pool, central, order.id)).status).toBe('cancelled');
    expect((await listStockOrderRefunds(pool, central, order.id))[0]?.status).toBe('requested');

    // Razorpay created the refund but our process died before saving it.
    const refundRow = (await listStockOrderRefunds(pool, central, order.id))[0];
    const orphan = await gateway.refundPayment({
      paymentId,
      amountPaise: 1,
      refundRef: refundRow?.id ?? '',
    });
    const retry = await cancelStockOrder(pool, central, order.id, request, gateway);
    expect(retry.refund?.razorpayRefundId).toBe(orphan.id);
    expect([...refunds.values()].filter((r) => r.payment_id === paymentId)).toHaveLength(1);
  });

  it('allows a new refund after Razorpay reports the first one failed', async () => {
    const { order, paymentId } = await paidOrder();
    await cancelStockOrder(
      pool,
      central,
      order.id,
      { submissionId: randomUUID(), reason: 'x' },
      gateway,
    );
    const first = [...refunds.values()].find((r) => r.payment_id === paymentId);
    if (!first) throw new Error('refund missing');
    await handleRazorpayWebhook(pool, refundWebhook('refund.failed', first), gateway);
    expect((await listStockOrderRefunds(pool, central, order.id))[0]?.status).toBe('failed');
    const second = await cancelStockOrder(
      pool,
      central,
      order.id,
      { submissionId: randomUUID(), reason: 'Retry refund' },
      gateway,
    );
    expect(second.refund?.status).toBe('pending');
    expect([...refunds.values()].filter((r) => r.payment_id === paymentId)).toHaveLength(2);
  });

  it('records a payment captured after cancellation so it can be refunded', async () => {
    const order = await newOrder();
    const sub = await submitStockOrderForPayment(pool, owner, order.id, gateway);
    await pool.query("update stock.stock_orders set status = 'awaiting_payment' where id = $1", [
      order.id,
    ]);
    await cancelStockOrder(
      pool,
      owner,
      order.id,
      { submissionId: randomUUID(), reason: 'x' },
      gateway,
    );
    const paymentId = `pay_${randomUUID().slice(0, 8)}`;
    const body = JSON.stringify({ id: `evt_${randomUUID()}` });
    const res = await handleRazorpayWebhook(
      pool,
      {
        eventId: `evt_${randomUUID()}`,
        eventType: 'payment.captured',
        rawBody: body,
        signature: signWebhook(body, 'w'),
        payload: {
          payload: {
            payment: {
              entity: {
                id: paymentId,
                order_id: sub.razorpayOrderId,
                amount: sub.amountPaise,
                currency: 'INR',
              },
            },
          },
        },
      },
      gateway,
    );
    expect(res.processed).toBe(true);
    const refund = await cancelStockOrder(
      pool,
      central,
      order.id,
      { submissionId: randomUUID(), reason: 'Paid after cancel' },
      gateway,
    );
    expect(refund.refund).toMatchObject({ status: 'pending', amountPaise: sub.amountPaise });
  });

  it('refuses to cancel once stock is allocated', async () => {
    const { order } = await paidOrder();
    await pool.query(
      'update stock.stock_order_lines set allocated_qty_base = 1 where stock_order_id = $1',
      [order.id],
    );
    await expect(
      cancelStockOrder(
        pool,
        central,
        order.id,
        { submissionId: randomUUID(), reason: 'x' },
        gateway,
      ),
    ).rejects.toThrow(/Release the allocation/);
  });
});
