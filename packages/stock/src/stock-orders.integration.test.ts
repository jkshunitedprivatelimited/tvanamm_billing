/**
 * Stock S4 (part 1) franchise orders against a real Postgres: catalog-snapshot
 * pricing, the Razorpay boundary (server-side signature verification,
 * reconciliation, replay-safe webhook), and the payment gate before fulfilment.
 * Runs only when STOCK_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, configureOutletStock } from './inventory';
import {
  publishCatalogItem,
  upsertDeliveryRule,
  getSupplyCatalogForOutlet,
} from './supply-catalog';
import {
  confirmCheckoutCallback,
  createStockOrder,
  handleRazorpayWebhook,
  reconcileStockOrderPayment,
  submitStockOrderForPayment,
  getStockOrder,
} from './stock-orders';
import { listOutletOrders, listSupplyCatalogForCentral } from './reads';
import { signCheckout, signWebhook, stubRazorpayGateway, type RazorpayPayment } from './razorpay';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = '11111111-1111-4111-8111-111111111111';
const OUTLET = '22222222-2222-4222-8222-222222222222';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let owner: StockActor;
let catalogItemId: string;

const payments = new Map<string, RazorpayPayment>();
const gateway = stubRazorpayGateway({ keySecret: 'k', webhookSecret: 'w', payments });

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);
  owner = {
    request: 'admin',
    role: 'franchise_owner',
    accountId: '000000ee-0000-4000-8000-0000000000e5',
    organizationId: ORG,
    franchiseId: FRANCHISE,
    warehouseIds: [],
  };

  const item = await createItem(pool, sys, {
    organizationId: ORG,
    sku: `CUP-${S}`,
    name: 'Paper Cup',
    itemType: 'packaging',
    dimension: 'count',
    baseUnit: 'each',
    supplyRule: 'jksh_required',
  });
  const rule = await upsertDeliveryRule(pool, sys, {
    organizationId: ORG,
    name: `Flat ${S}`,
    kind: 'flat',
    amountPaise: 5000,
  });
  catalogItemId = (
    await publishCatalogItem(pool, sys, {
      organizationId: ORG,
      itemId: item.id,
      gstInclusivePricePaise: 105,
      gstRate: 5,
      hsnCode: '4823',
      deliveryRuleId: rule.id,
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

describe.skipIf(!RUN)('Stock franchise orders', () => {
  let orderId: string;
  let rzpOrderId: string;
  const payOk = `pay_ok1-${S}`;
  const payForged = `pay_forged-${S}`;
  const payWebhook = `pay_wh1-${S}`;

  it('prices an order purely from the catalog snapshot', async () => {
    const cat = await getSupplyCatalogForOutlet(pool, owner, OUTLET);
    expect(cat.some((c) => c.id === catalogItemId)).toBe(true);
    expect((await listSupplyCatalogForCentral(pool, sys)).some((c) => c.pricePaise === 105)).toBe(
      true,
    );
    await expect(listSupplyCatalogForCentral(pool, owner)).rejects.toThrow(/capability/);

    const order = await createStockOrder(pool, owner, {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      orderNumber: `SO-${S}`,
      lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: '100' }],
    });
    // 100 * 105 = 10500 gst-inclusive; taxable = round(10500 / 1.05) = 10000; tax 500; delivery 5000
    expect(order.subtotalPaise).toBe(10000);
    expect(order.taxPaise).toBe(500);
    expect(order.deliveryPaise).toBe(5000);
    expect(order.totalPaise).toBe(15500);
    orderId = order.id;
  });

  it('retries one order reference safely and rejects a changed basket', async () => {
    const command = {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      orderNumber: `SO-RETRY-${S}`,
      lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: '25' }],
    };
    const [first, retry] = await Promise.all([
      createStockOrder(pool, owner, command),
      createStockOrder(pool, owner, command),
    ]);
    expect(retry).toEqual(first);
    await expect(
      createStockOrder(pool, owner, {
        ...command,
        lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: '26' }],
      }),
    ).rejects.toThrow(/another basket/);
    const history = await listOutletOrders(pool, owner, OUTLET);
    expect(history.orders.filter((o) => o.id === first.id)).toHaveLength(1);
    const detail = await getStockOrder(pool, owner, first.id);
    expect(detail.outletId).toBe(OUTLET);
    expect(detail.lines[0]?.itemName).toBe('Paper Cup');
    expect(detail.lines[0]?.baseUnit).toBe('each');
    const foreign = { ...owner, franchiseId: '99999999-9999-4999-8999-999999999999' };
    await expect(listOutletOrders(pool, foreign, OUTLET)).rejects.toThrow();
    await expect(getStockOrder(pool, foreign, first.id)).rejects.toThrow(/not found/);
  });

  it('rejects an order for another franchise', async () => {
    await expect(
      createStockOrder(pool, owner, {
        organizationId: ORG,
        outletId: OUTLET,
        franchiseId: '99999999-9999-4999-8999-999999999999',
        orderNumber: `SO-BAD-${S}`,
        lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: '1' }],
      }),
    ).rejects.toThrow(/another franchise/i);
  });

  it('creates one Razorpay order even on a duplicate submit', async () => {
    const first = await submitStockOrderForPayment(pool, owner, orderId, gateway);
    const second = await submitStockOrderForPayment(pool, owner, orderId, gateway);
    expect(first.razorpayOrderId).toBe(second.razorpayOrderId);
    expect(first.amountPaise).toBe(15500);
    rzpOrderId = first.razorpayOrderId;
    const { rows } = await pool.query<{ n: string }>(
      'select count(*) as n from stock.stock_order_payments where stock_order_id = $1',
      [orderId],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('gives an invalid checkout signature no financial effect', async () => {
    await expect(
      confirmCheckoutCallback(
        pool,
        owner,
        { orderId, razorpayPaymentId: payForged, razorpaySignature: 'deadbeef' },
        gateway,
      ),
    ).rejects.toThrow(/signature is invalid/i);
    const view = await getStockOrder(pool, owner, orderId);
    expect(view.status).toBe('awaiting_payment');
  });

  it('advances to payment_pending on a valid callback but not to paid', async () => {
    const sig = signCheckout(rzpOrderId, payOk, 'k');
    const res = await confirmCheckoutCallback(
      pool,
      owner,
      { orderId, razorpayPaymentId: payOk, razorpaySignature: sig },
      gateway,
    );
    expect(res.status).toBe('payment_pending');
    expect((await getStockOrder(pool, owner, orderId)).status).toBe('payment_pending');
  });

  it('only a captured payment for the exact amount marks the order paid', async () => {
    payments.set(payOk, {
      id: payOk,
      order_id: rzpOrderId,
      amount: 15499, // wrong by one paise
      currency: 'INR',
      status: 'captured',
    });
    expect((await reconcileStockOrderPayment(pool, owner, orderId, gateway)).status).toBe(
      'payment_pending',
    );

    payments.set(payOk, {
      id: payOk,
      order_id: rzpOrderId,
      amount: 15500,
      currency: 'INR',
      status: 'captured',
    });
    expect((await reconcileStockOrderPayment(pool, owner, orderId, gateway)).status).toBe('paid');
    const view = await getStockOrder(pool, owner, orderId);
    expect(view.capturedAmountPaise).toBe(15500);

    const outbox = await pool.query<{ n: string }>(
      `select count(*) as n from stock_outbox.events
        where aggregate_id = $1 and event_type = 'StockOrderPaid'`,
      [orderId],
    );
    expect(Number(outbox.rows[0]!.n)).toBe(1);
  });

  it('processes a payment.captured webhook once and ignores replays', async () => {
    const order2 = await createStockOrder(pool, owner, {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      orderNumber: `SO2-${S}`,
      lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: '10' }],
    });
    const sub = await submitStockOrderForPayment(pool, owner, order2.id, gateway);
    const body = JSON.stringify({ id: `evt_${S}` });
    const webhook = {
      eventId: `evt_${S}`,
      eventType: 'payment.captured',
      rawBody: body,
      signature: signWebhook(body, 'w'),
      payload: {
        payload: {
          payment: {
            entity: {
              id: payWebhook,
              order_id: sub.razorpayOrderId,
              amount: order2.totalPaise,
              currency: 'INR',
            },
          },
        },
      },
    };
    const first = await handleRazorpayWebhook(pool, webhook, gateway);
    expect(first).toEqual({ duplicate: false, processed: true });
    const replay = await handleRazorpayWebhook(pool, webhook, gateway);
    expect(replay.duplicate).toBe(true);
    expect((await getStockOrder(pool, owner, order2.id)).status).toBe('paid');
  });

  it('rejects a webhook with a bad signature', async () => {
    await expect(
      handleRazorpayWebhook(
        pool,
        {
          eventId: `evt_bad_${S}`,
          eventType: 'payment.captured',
          rawBody: '{}',
          signature: 'nope',
          payload: {},
        },
        gateway,
      ),
    ).rejects.toThrow(/signature is invalid/i);
  });
});
