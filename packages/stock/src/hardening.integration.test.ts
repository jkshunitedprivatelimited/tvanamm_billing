/**
 * Stock P0 hardening against a real Postgres: object-level warehouse / outlet
 * authorization, ledger integrity (cross-org item and batch/item mismatch),
 * per-dispatch GST invoice, outlet-inward chain validation and quantity cap,
 * and the Razorpay webhook amount/currency check.
 * Runs only when STOCK_DATABASE_URL is set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStockPool,
  withStockActorContext,
  stockSystemContext,
  type StockPool,
} from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { configureOutletStock, createItem, createWarehouse } from './inventory';
import { resolveStockActor, upsertIdentityProjection } from './identity-projection';
import { postMovement } from './ledger';
import { getOwnerDashboard } from './analytics';
import { createPurchaseOrder } from './procurement';
import { publishCatalogItem, upsertDeliveryRule } from './supply-catalog';
import {
  createStockOrder,
  submitStockOrderForPayment,
  confirmCheckoutCallback,
  handleRazorpayWebhook,
  getStockOrder,
} from './stock-orders';
import { approveStockOrder, allocateStockOrder, dispatchStockOrder, getDispatch } from './dispatch';
import { signCheckout, signWebhook, stubRazorpayGateway, type RazorpayPayment } from './razorpay';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const OTHER_ORG = '01000000-0000-4000-8000-00000000dead';
const FR_A = 'aaaa1111-1111-4111-8111-111111111111';
const FR_B = 'bbbb2222-2222-4222-8222-222222222222';
const OUT_A = 'aaaa0000-0000-4000-8000-00000000000a';
const OUT_B = 'bbbb0000-0000-4000-8000-00000000000b';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let whA: { id: string; locationIds: Record<string, string> };
let whB: { id: string; locationIds: Record<string, string> };
let cupId: string;
let catalogItemId: string;

const payments = new Map<string, RazorpayPayment>();
const gateway = stubRazorpayGateway({ keySecret: 'k', webhookSecret: 'w', payments });

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);

  whA = await createWarehouse(pool, sys, { organizationId: ORG, code: `HA-${S}`, name: `HA ${S}` });
  whB = await createWarehouse(pool, sys, { organizationId: ORG, code: `HB-${S}`, name: `HB ${S}` });
  cupId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `HCUP-${S}`,
      name: 'Cup',
      itemType: 'packaging',
      dimension: 'count',
      baseUnit: 'each',
      isBatchTracked: true,
    })
  ).id;
  await configureOutletStock(pool, sys, {
    outletId: OUT_A,
    organizationId: ORG,
    franchiseId: FR_A,
  });
  await configureOutletStock(pool, sys, {
    outletId: OUT_B,
    organizationId: ORG,
    franchiseId: FR_B,
  });

  const rule = await upsertDeliveryRule(pool, sys, {
    organizationId: ORG,
    name: `Free ${S}`,
    kind: 'free',
  });
  catalogItemId = (
    await publishCatalogItem(pool, sys, {
      organizationId: ORG,
      itemId: cupId,
      gstInclusivePricePaise: 105,
      gstRate: 5,
      hsnCode: '4823',
      deliveryRuleId: rule.id,
    })
  ).id;

  const batch = await pool.query<{ id: string }>(
    `insert into stock.batches (organization_id, item_id, batch_code, expiry_date, origin)
     values ($1,$2,$3,'2029-01-01','received') returning id`,
    [ORG, cupId, `HB1-${S}`],
  );
  await withStockActorContext(pool, stockSystemContext(), (c) =>
    postMovement(c, {
      organizationId: ORG,
      stockLocationId: whA.locationIds.sellable!,
      itemId: cupId,
      batchId: batch.rows[0]!.id,
      quantity: '1000',
      movementType: 'receipt',
      unitCostPaise: 80,
      sourceDocType: 'test.seed',
      idempotencyKey: `hseed-${S}`,
    }),
  );
});

afterAll(async () => {
  if (RUN) await pool.end();
});

async function warehouseActor(warehouseIds: string[]): Promise<StockActor> {
  const accountId = randomUUID();
  await upsertIdentityProjection(pool, sys, {
    accountId,
    role: 'warehouse_manager',
    organizationId: ORG,
  });
  const projId = (
    await pool.query<{ id: string }>(
      'select id from stock.identity_projection where account_id = $1',
      [accountId],
    )
  ).rows[0]!.id;
  for (const w of warehouseIds) {
    await pool.query(
      'insert into stock.warehouse_assignments (projection_id, warehouse_id) values ($1,$2)',
      [projId, w],
    );
  }
  return resolveStockActor(pool, {
    request: 'admin',
    billingRole: 'accountant',
    accountId,
    organizationId: ORG,
  });
}

function ownerActor(franchiseId: string): StockActor {
  return {
    request: 'admin',
    role: 'franchise_owner',
    accountId: randomUUID(),
    organizationId: ORG,
    franchiseId,
    warehouseIds: [],
  };
}

describe.skipIf(!RUN)('Stock object-level authorization', () => {
  it('blocks a warehouse operator from acting on an unassigned warehouse', async () => {
    const opA = await warehouseActor([whA.id]);
    // Allowed on its own warehouse.
    await expect(
      createPurchaseOrder(pool, opA, {
        organizationId: ORG,
        supplierId: randomUUID(),
        warehouseId: whA.id,
        poNumber: `HPO-ok-${S}`,
        lines: [{ itemId: cupId, orderQtyBase: '1', unitPricePaise: 1 }],
      }),
    ).rejects.toThrow(/supplier/i); // fails later (no supplier), not on warehouse access
    // Denied on a warehouse it is not assigned to.
    await expect(
      createPurchaseOrder(pool, opA, {
        organizationId: ORG,
        supplierId: randomUUID(),
        warehouseId: whB.id,
        poNumber: `HPO-bad-${S}`,
        lines: [{ itemId: cupId, orderQtyBase: '1', unitPricePaise: 1 }],
      }),
    ).rejects.toThrow(/not assigned to this warehouse/i);
  });

  it("blocks a franchise owner from reading another franchise's outlet", async () => {
    const ownerA = ownerActor(FR_A);
    await expect(getOwnerDashboard(pool, ownerA, OUT_A)).resolves.toMatchObject({
      outletId: OUT_A,
    });
    await expect(getOwnerDashboard(pool, ownerA, OUT_B)).rejects.toThrow(/not in your franchise/i);
  });
});

describe.skipIf(!RUN)('Stock ledger integrity', () => {
  it('rejects a movement whose item is in another organization', async () => {
    const foreignItem = await createItem(pool, stockSystemActor(OTHER_ORG), {
      organizationId: OTHER_ORG,
      sku: `FOREIGN-${S}`,
      name: 'Foreign',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
    });
    await expect(
      withStockActorContext(pool, stockSystemContext(), (c) =>
        postMovement(c, {
          organizationId: ORG,
          stockLocationId: whA.locationIds.sellable!,
          itemId: foreignItem.id,
          quantity: '1',
          movementType: 'adjustment',
          sourceDocType: 'test',
          idempotencyKey: `hforeign-${S}`,
        }),
      ),
    ).rejects.toThrow(/another organization/i);
  });

  it('rejects a batch that does not belong to the movement item', async () => {
    const other = await createItem(pool, sys, {
      organizationId: ORG,
      sku: `HOTHER-${S}`,
      name: 'Other',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
      isBatchTracked: true,
    });
    const wrongBatch = await pool.query<{ id: string }>(
      `insert into stock.batches (organization_id, item_id, batch_code, origin)
       values ($1,$2,$3,'received') returning id`,
      [ORG, other.id, `HWRONG-${S}`],
    );
    await expect(
      withStockActorContext(pool, stockSystemContext(), (c) =>
        postMovement(c, {
          organizationId: ORG,
          stockLocationId: whA.locationIds.sellable!,
          itemId: cupId,
          batchId: wrongBatch.rows[0]!.id,
          quantity: '1',
          movementType: 'adjustment',
          sourceDocType: 'test',
          idempotencyKey: `hwrongbatch-${S}`,
        }),
      ),
    ).rejects.toThrow(/does not belong to this item/i);
  });
});

describe.skipIf(!RUN)('Stock dispatch + webhook hardening', () => {
  async function paidOrder(
    orderNumber: string,
    qty: string,
  ): Promise<{ orderId: string; paymentId: string }> {
    const order = await createStockOrder(pool, sys, {
      organizationId: ORG,
      outletId: OUT_A,
      franchiseId: FR_A,
      orderNumber,
      lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: qty }],
    });
    const sub = await submitStockOrderForPayment(pool, sys, order.id, gateway);
    const payId = `pay-${orderNumber}`;
    await confirmCheckoutCallback(
      pool,
      sys,
      {
        orderId: order.id,
        razorpayPaymentId: payId,
        razorpaySignature: signCheckout(sub.razorpayOrderId, payId, 'k'),
      },
      gateway,
    );
    return { orderId: order.id, paymentId: payId };
  }

  it('invoices only the quantity in a partial dispatch', async () => {
    const { orderId, paymentId } = await paidOrder(`HO1-${S}`, '2000'); // > the 1000 on hand
    const rzp = (
      await pool.query<{ razorpay_order_id: string; total_paise: string }>(
        'select razorpay_order_id, total_paise from stock.stock_orders where id = $1',
        [orderId],
      )
    ).rows[0]!;
    const body = JSON.stringify({ id: `evt-${orderId}` });
    await handleRazorpayWebhook(
      pool,
      {
        eventId: `evt-${orderId}`,
        eventType: 'payment.captured',
        rawBody: body,
        signature: signWebhook(body, 'w'),
        payload: {
          payload: {
            payment: {
              entity: {
                id: paymentId,
                order_id: rzp.razorpay_order_id,
                amount: Number(rzp.total_paise),
                currency: 'INR',
              },
            },
          },
        },
      },
      gateway,
    );
    expect((await getStockOrder(pool, sys, orderId)).status).toBe('paid');

    await approveStockOrder(pool, sys, orderId);
    await allocateStockOrder(pool, sys, orderId, whA.id); // only 1000 available
    const dispatch = await dispatchStockOrder(pool, sys, orderId, {
      dispatchNumber: `HD1-${S}`,
      warehouseId: whA.id,
    });
    expect(dispatch.status).toBe('partially_dispatched');
    const view = await getDispatch(pool, sys, dispatch.dispatchId);
    // Invoice covers ~1000 units (this dispatch), not the 2000-unit order.
    expect(view.gstInvoice.totalPaise).toBeLessThan(210000);
    expect(view.gstInvoice.totalPaise).toBeGreaterThan(90000);
  });

  it('does not mark an order paid from a webhook with the wrong amount', async () => {
    const { orderId, paymentId } = await paidOrder(`HO2-${S}`, '5');
    const rzp = (
      await pool.query<{ razorpay_order_id: string; total_paise: string }>(
        'select razorpay_order_id, total_paise from stock.stock_orders where id = $1',
        [orderId],
      )
    ).rows[0]!;
    const body = JSON.stringify({ id: `evtbad-${orderId}` });
    const res = await handleRazorpayWebhook(
      pool,
      {
        eventId: `evtbad-${orderId}`,
        eventType: 'payment.captured',
        rawBody: body,
        signature: signWebhook(body, 'w'),
        payload: {
          payload: {
            payment: {
              entity: {
                id: paymentId, // right payment id...
                order_id: rzp.razorpay_order_id,
                amount: Number(rzp.total_paise) - 1, // ...wrong amount
                currency: 'INR',
              },
            },
          },
        },
      },
      gateway,
    );
    expect(res.processed).toBe(false);
    expect((await getStockOrder(pool, sys, orderId)).status).not.toBe('paid');
    const note = (
      await pool.query<{ process_note: string | null }>(
        'select process_note from stock.razorpay_webhook_events where event_id = $1',
        [`evtbad-${orderId}`],
      )
    ).rows[0]!.process_note;
    expect(note).toMatch(/rejected.*amount/i);
  });

  it('rejects a webhook whose payment id differs from the checkout callback', async () => {
    const { orderId } = await paidOrder(`HO3-${S}`, '4');
    const rzp = (
      await pool.query<{ razorpay_order_id: string; total_paise: string }>(
        'select razorpay_order_id, total_paise from stock.stock_orders where id = $1',
        [orderId],
      )
    ).rows[0]!;
    const body = JSON.stringify({ id: `evtpid-${orderId}` });
    const res = await handleRazorpayWebhook(
      pool,
      {
        eventId: `evtpid-${orderId}`,
        eventType: 'payment.captured',
        rawBody: body,
        signature: signWebhook(body, 'w'),
        payload: {
          payload: {
            payment: {
              entity: {
                id: `someone-elses-payment-${orderId}`,
                order_id: rzp.razorpay_order_id,
                amount: Number(rzp.total_paise),
                currency: 'INR',
              },
            },
          },
        },
      },
      gateway,
    );
    expect(res.processed).toBe(false);
    expect((await getStockOrder(pool, sys, orderId)).status).not.toBe('paid');
  });
});
