/**
 * Stock S4 (part 2) fulfilment against a real Postgres: approve -> FEFO
 * allocate -> dispatch with a GST invoice snapshot -> outlet inward with
 * discrepancies -> credit note, plus partial allocation / backorder and the
 * payment gate before dispatch. Runs only when STOCK_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, createWarehouse, configureOutletStock, getItemBalances } from './inventory';
import { postMovements } from './ledger';
import { publishCatalogItem, upsertDeliveryRule } from './supply-catalog';
import {
  createStockOrder,
  submitStockOrderForPayment,
  confirmCheckoutCallback,
  reconcileStockOrderPayment,
  getStockOrder,
} from './stock-orders';
import {
  approveStockOrder,
  allocateStockOrder,
  dispatchStockOrder,
  recordOutletInward,
  resolveDiscrepancy,
  getDispatch,
} from './dispatch';
import { listPendingDeliveries } from './reads';
import { signCheckout, stubRazorpayGateway, type RazorpayPayment } from './razorpay';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = '11111111-1111-4111-8111-111111111111';
const OUTLET = '33333333-3333-4333-8333-333333333333';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let owner: StockActor;
let wh: { id: string; locationIds: Record<string, string> };
let cupItemId: string;
let catalogItemId: string;
let outletSellableLoc: string;

const payments = new Map<string, RazorpayPayment>();
const gateway = stubRazorpayGateway({ keySecret: 'k', webhookSecret: 'w', payments });

async function paidOrder(orderNumber: string, qty: string): Promise<string> {
  const order = await createStockOrder(pool, owner, {
    organizationId: ORG,
    outletId: OUTLET,
    franchiseId: FRANCHISE,
    orderNumber,
    lines: [{ supplyCatalogItemId: catalogItemId, qtyBase: qty }],
  });
  const sub = await submitStockOrderForPayment(pool, owner, order.id, gateway);
  const payId = `pay-${orderNumber}`;
  await confirmCheckoutCallback(
    pool,
    owner,
    {
      orderId: order.id,
      razorpayPaymentId: payId,
      razorpaySignature: signCheckout(sub.razorpayOrderId, payId, 'k'),
    },
    gateway,
  );
  payments.set(payId, {
    id: payId,
    order_id: sub.razorpayOrderId,
    amount: sub.amountPaise,
    currency: 'INR',
    status: 'captured',
  });
  await reconcileStockOrderPayment(pool, owner, order.id, gateway);
  return order.id;
}

async function whOnHand(): Promise<number> {
  return (await getItemBalances(pool, sys, cupItemId))
    .filter((r) => r.stockLocationId === wh.locationIds.sellable)
    .reduce((s, r) => s + Number(r.onHand), 0);
}
async function whAllocated(): Promise<number> {
  return (await getItemBalances(pool, sys, cupItemId))
    .filter((r) => r.stockLocationId === wh.locationIds.sellable)
    .reduce((s, r) => s + Number(r.allocated), 0);
}
async function outletOnHand(): Promise<number> {
  return (await getItemBalances(pool, sys, cupItemId))
    .filter((r) => r.stockLocationId === outletSellableLoc)
    .reduce((s, r) => s + Number(r.onHand), 0);
}

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);
  owner = {
    request: 'admin',
    role: 'franchise_owner',
    accountId: '000000ff-0000-4000-8000-0000000000f6',
    organizationId: ORG,
    franchiseId: FRANCHISE,
    warehouseIds: [],
  };

  const item = await createItem(pool, sys, {
    organizationId: ORG,
    sku: `DCUP-${S}`,
    name: 'Cup',
    itemType: 'packaging',
    dimension: 'count',
    baseUnit: 'each',
    supplyRule: 'jksh_required',
    isBatchTracked: true,
  });
  cupItemId = item.id;
  wh = await createWarehouse(pool, sys, {
    organizationId: ORG,
    code: `DWH-${S}`,
    name: `DWH ${S}`,
  });

  const batch = await pool.query<{ id: string }>(
    `insert into stock.batches (organization_id, item_id, batch_code, expiry_date, origin)
     values ($1,$2,$3,'2028-01-01','received') returning id`,
    [ORG, cupItemId, `DB-${S}`],
  );
  await postMovements(pool, [
    {
      organizationId: ORG,
      stockLocationId: wh.locationIds.sellable!,
      itemId: cupItemId,
      batchId: batch.rows[0]!.id,
      quantity: '500',
      movementType: 'receipt',
      unitCostPaise: 80,
      sourceDocType: 'test.seed',
      idempotencyKey: `dseed-${S}`,
    },
  ]);

  const rule = await upsertDeliveryRule(pool, sys, {
    organizationId: ORG,
    name: `Free ${S}`,
    kind: 'free',
  });
  catalogItemId = (
    await publishCatalogItem(pool, sys, {
      organizationId: ORG,
      itemId: cupItemId,
      gstInclusivePricePaise: 105,
      gstRate: 5,
      hsnCode: '4823',
      deliveryRuleId: rule.id,
    })
  ).id;
  outletSellableLoc = (
    await configureOutletStock(pool, sys, {
      outletId: OUTLET,
      organizationId: ORG,
      franchiseId: FRANCHISE,
    })
  ).sellableLocationId;
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Stock fulfilment', () => {
  it('runs the full approve -> allocate -> dispatch -> inward path', async () => {
    const orderId = await paidOrder(`FO-${S}`, '100');
    expect((await getStockOrder(pool, owner, orderId)).status).toBe('paid');

    // Cannot dispatch before allocation.
    await expect(
      dispatchStockOrder(pool, sys, orderId, {
        dispatchNumber: `D-early-${S}`,
        warehouseId: wh.id,
      }),
    ).rejects.toThrow();

    await approveStockOrder(pool, sys, orderId);
    const alloc = await allocateStockOrder(pool, sys, orderId, wh.id);
    expect(alloc.fullyAllocated).toBe(true);
    expect(await whAllocated()).toBe(100);

    const whBefore = await whOnHand();
    const dispatch = await dispatchStockOrder(pool, sys, orderId, {
      dispatchNumber: `D-${S}`,
      warehouseId: wh.id,
    });
    expect(dispatch.status).toBe('dispatched');
    expect(await whOnHand()).toBe(whBefore - 100);
    expect(await whAllocated()).toBe(0);

    const view = await getDispatch(pool, sys, dispatch.dispatchId);
    expect(view.gstInvoice.totalPaise).toBe(10500);
    expect(view.gstInvoice.taxablePaise).toBe(10000);
    expect(view.gstInvoice.gstPaise).toBe(500);

    const dispatchLineId = (
      await pool.query<{ id: string }>(
        'select id from stock.stock_dispatch_lines where stock_dispatch_id = $1',
        [dispatch.dispatchId],
      )
    ).rows[0]!.id;

    const outletBefore = await outletOnHand();
    const awaiting = await listPendingDeliveries(pool, owner, OUTLET);
    expect(awaiting.some((d) => d.id === dispatch.dispatchId)).toBe(true);
    expect(awaiting.find((d) => d.id === dispatch.dispatchId)?.lines.length).toBeGreaterThan(0);
    const inward = await recordOutletInward(pool, owner, {
      organizationId: ORG,
      stockOrderId: orderId,
      stockDispatchId: dispatch.dispatchId,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      inwardNumber: `IN-${S}`,
      lines: [
        {
          stockDispatchLineId: dispatchLineId,
          acceptedQtyBase: '90',
          shortQtyBase: '5',
          damagedQtyBase: '5',
        },
      ],
    });
    expect(inward.discrepancies).toBe(2);
    expect(await outletOnHand()).toBe(outletBefore + 90);

    const shortDisc = (
      await pool.query<{ id: string }>(
        `select id from stock.stock_order_discrepancies where outlet_inward_id = $1 and kind = 'short'`,
        [inward.inwardId],
      )
    ).rows[0]!.id;
    const res = await resolveDiscrepancy(pool, sys, shortDisc, 'credit_note', {
      creditNoteNumber: `CN-${S}`,
    });
    expect(res.creditNoteId).toBeTruthy();
    const cn = await pool.query<{ amount_paise: string }>(
      'select amount_paise from stock.credit_notes where id = $1',
      [res.creditNoteId],
    );
    expect(Number(cn.rows[0]!.amount_paise)).toBe(525); // 5 * 105
  });

  it('allocates partially and backorders the remainder', async () => {
    const orderId = await paidOrder(`FO2-${S}`, '1000');
    await approveStockOrder(pool, sys, orderId);
    const alloc = await allocateStockOrder(pool, sys, orderId, wh.id);
    expect(alloc.fullyAllocated).toBe(false);

    const dispatch = await dispatchStockOrder(pool, sys, orderId, {
      dispatchNumber: `D2-${S}`,
      warehouseId: wh.id,
    });
    expect(dispatch.status).toBe('partially_dispatched');
    const view = await getStockOrder(pool, owner, orderId);
    const line = view.lines[0]!;
    expect(Number(line.dispatchedQtyBase)).toBeLessThan(Number(line.qtyBase));
    expect(Number(line.dispatchedQtyBase)).toBeGreaterThan(0);
  });
});
