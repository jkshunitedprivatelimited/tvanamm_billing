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
  type RecordOutletInwardCommand,
} from './dispatch';
import {
  getShipmentPreparation,
  saveShipmentPreparation,
  type ShipmentPreparationDetails,
} from './shipment-preparation';
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

async function receiptCommand(label: string, qty: string): Promise<RecordOutletInwardCommand> {
  const orderId = await paidOrder(`${label}-${S}`, qty);
  await approveStockOrder(pool, sys, orderId);
  await allocateStockOrder(pool, sys, orderId, wh.id);
  const dispatch = await dispatchStockOrder(pool, sys, orderId, {
    warehouseId: wh.id,
    dispatchNumber: `D-${label}-${S}`,
  });
  const lines = await pool.query<{ id: string; qty_base: string }>(
    'select id, qty_base from stock.stock_dispatch_lines where stock_dispatch_id = $1',
    [dispatch.dispatchId],
  );
  return {
    organizationId: ORG,
    stockOrderId: orderId,
    stockDispatchId: dispatch.dispatchId,
    outletId: OUTLET,
    franchiseId: FRANCHISE,
    inwardNumber: `IN-${label}-${S}`,
    lines: lines.rows.map((line) => ({
      stockDispatchLineId: line.id,
      acceptedQtyBase: line.qty_base,
    })),
  };
}

async function receiptCounts(inwardId: string, inwardNumber: string) {
  const result = await pool.query<{
    receipts: number;
    lines: number;
    movements: number;
    discrepancies: number;
    audits: number;
  }>(
    `select
       (select count(*)::int from stock.outlet_inwards
         where organization_id = $2 and inward_number = $3) as receipts,
       (select count(*)::int from stock.outlet_inward_lines where outlet_inward_id = $1) as lines,
       (select count(*)::int from stock.stock_movements
         where source_doc_type = 'outlet_inward' and source_doc_id = $1) as movements,
       (select count(*)::int from stock.stock_order_discrepancies
         where outlet_inward_id = $1) as discrepancies,
       (select count(*)::int from stock_audit.events
         where action = 'outlet_inward.recorded' and subject_id = $1) as audits`,
    [inwardId, ORG, inwardNumber],
  );
  return result.rows[0];
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

  it('recovers a lost inward acknowledgement without repeating stock or discrepancies', async () => {
    const cmd = await receiptCommand('RETRY', '10');
    cmd.lines = [
      {
        ...cmd.lines[0]!,
        acceptedQtyBase: '6',
        shortQtyBase: '1',
        damagedQtyBase: '1',
        excessQtyBase: '2',
        rejectedQtyBase: '2',
      },
    ];
    const before = await outletOnHand();
    const saved = await recordOutletInward(pool, owner, cmd);
    expect(saved).toMatchObject({ status: 'partially_received', discrepancies: 4 });
    expect(await recordOutletInward(pool, owner, cmd)).toEqual(saved);
    expect(
      await recordOutletInward(pool, owner, {
        ...cmd,
        lines: [{ ...cmd.lines[0]!, acceptedQtyBase: '6.000000' }],
      }),
    ).toEqual(saved);

    for (const field of [
      'acceptedQtyBase',
      'shortQtyBase',
      'damagedQtyBase',
      'excessQtyBase',
      'rejectedQtyBase',
    ] as const) {
      await expect(
        recordOutletInward(pool, owner, {
          ...cmd,
          lines: [{ ...cmd.lines[0]!, [field]: '0' }],
        }),
      ).rejects.toMatchObject({ code: 'conflict' });
    }
    await expect(recordOutletInward(pool, owner, { ...cmd, lines: [] })).rejects.toMatchObject({
      code: 'conflict',
    });

    const short = await pool.query<{ id: string }>(
      `select id from stock.stock_order_discrepancies where outlet_inward_id = $1 and kind = 'short'`,
      [saved.inwardId],
    );
    await resolveDiscrepancy(pool, sys, short.rows[0]!.id, 'written_off');
    expect(await recordOutletInward(pool, owner, cmd)).toEqual(saved);
    expect(await outletOnHand()).toBe(before + 6);
    expect((await getStockOrder(pool, owner, cmd.stockOrderId)).lines[0]?.receivedQtyBase).toBe(
      '6.000000',
    );
    expect(await receiptCounts(saved.inwardId, cmd.inwardNumber)).toEqual({
      receipts: 1,
      lines: 1,
      movements: 1,
      discrepancies: 4,
      audits: 1,
    });
  });

  it('returns one saved receipt for concurrent identical inwards', async () => {
    const cmd = await receiptCommand('CONCURRENT', '8');
    const before = await outletOnHand();
    const results = await Promise.all([
      recordOutletInward(pool, owner, cmd),
      recordOutletInward(pool, owner, cmd),
      recordOutletInward(pool, owner, cmd),
    ]);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[0]).toMatchObject({ status: 'received', discrepancies: 0 });
    expect(
      await recordOutletInward(pool, owner, {
        ...cmd,
        lines: cmd.lines.map((line) => ({
          ...line,
          shortQtyBase: '0',
          damagedQtyBase: '0.000000',
        })),
      }),
    ).toEqual(results[0]);
    expect(await outletOnHand()).toBe(before + 8);
    expect((await getStockOrder(pool, owner, cmd.stockOrderId)).lines[0]?.receivedQtyBase).toBe(
      '8.000000',
    );
    expect(await receiptCounts(results[0]!.inwardId, cmd.inwardNumber)).toEqual({
      receipts: 1,
      lines: 1,
      movements: 1,
      discrepancies: 0,
      audits: 1,
    });
  });

  it('checks capability, organization, outlet and document scope before replaying a receipt', async () => {
    const cmd = await receiptCommand('SCOPE', '4');
    const otherCmd = await receiptCommand('SCOPE-OTHER', '4');
    const saved = await recordOutletInward(pool, owner, cmd);
    const before = await outletOnHand();
    const otherId = '99999999-9999-4999-8999-999999999999';
    for (const actor of [
      { ...owner, role: 'accountant' },
      { ...owner, franchiseId: otherId },
      { ...owner, allowedOutletIds: [] },
      { ...owner, request: 'operator', role: 'store_employee', outletId: otherId },
    ] satisfies StockActor[]) {
      await expect(recordOutletInward(pool, actor, cmd)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(recordOutletInward(pool, stockSystemActor(otherId), cmd)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      recordOutletInward(pool, sys, { ...cmd, organizationId: otherId }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      recordOutletInward(pool, sys, { ...cmd, outletId: otherId }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      recordOutletInward(pool, sys, { ...cmd, franchiseId: otherId }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      recordOutletInward(pool, owner, {
        ...otherCmd,
        inwardNumber: cmd.inwardNumber,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      recordOutletInward(pool, owner, { ...cmd, lines: otherCmd.lines }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await outletOnHand()).toBe(before);
    expect(await receiptCounts(saved.inwardId, cmd.inwardNumber)).toEqual({
      receipts: 1,
      lines: 1,
      movements: 1,
      discrepancies: 0,
      audits: 1,
    });
  });

  it('preserves the dispatch quantity cap across new receipts and retries', async () => {
    const cmd = await receiptCommand('CAP', '5');
    cmd.lines[0]!.acceptedQtyBase = '3';
    const before = await outletOnHand();
    const saved = await recordOutletInward(pool, owner, cmd);
    await expect(
      recordOutletInward(pool, owner, {
        ...cmd,
        inwardNumber: `${cmd.inwardNumber}-OVER`,
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
      message: 'Inward quantity exceeds the dispatched quantity',
    });
    const remainder = {
      ...cmd,
      inwardNumber: `${cmd.inwardNumber}-REST`,
      lines: [{ ...cmd.lines[0]!, acceptedQtyBase: '0', shortQtyBase: '1', damagedQtyBase: '1' }],
    };
    const restSaved = await recordOutletInward(pool, owner, remainder);
    expect(restSaved.discrepancies).toBe(2);
    expect(await recordOutletInward(pool, owner, remainder)).toEqual(restSaved);
    expect(await recordOutletInward(pool, owner, cmd)).toEqual(saved);
    expect(await outletOnHand()).toBe(before + 3);
    const receiptTotal = await pool.query<{ n: number }>(
      'select count(*)::int as n from stock.outlet_inwards where stock_dispatch_id = $1',
      [cmd.stockDispatchId],
    );
    expect(receiptTotal.rows[0]?.n).toBe(2);
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

describe.skipIf(!RUN)('Prepaid delivery preparation', () => {
  const details: ShipmentPreparationDetails = {
    paymentMethod: 'prepaid',
    pickupLocation: '',
    recipientName: '',
    recipientPhone: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    weightKg: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    carrierAcceptanceConfirmed: false,
  };
  it('saves incomplete drafts, retries safely and rejects stale edits without moving stock', async () => {
    const id = await paidOrder(`PREP-${S}`, '1');
    const before = await whOnHand();
    const input = { expectedRevision: 0, details };
    const results = await Promise.all([
      saveShipmentPreparation(pool, sys, id, wh.id, input),
      saveShipmentPreparation(pool, sys, id, wh.id, input),
    ]);
    expect(results.map((r) => r.revision)).toEqual([1, 1]);
    expect(results[0]!.missing).toContain('Packed weight in kg');
    expect(await getShipmentPreparation(pool, sys, id, wh.id)).toEqual(results[0]);
    await expect(
      saveShipmentPreparation(pool, sys, id, wh.id, {
        expectedRevision: 0,
        details: { ...details, recipientName: 'Different edit' },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      saveShipmentPreparation(pool, sys, id, wh.id, {
        expectedRevision: 1,
        details: { ...details, paymentMethod: 'cod' },
      }),
    ).rejects.toThrow();
    const complete = {
      ...details,
      pickupLocation: 'Test warehouse',
      recipientName: 'Test receiver',
      recipientPhone: '9999999999',
      address: 'Test address',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      weightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      carrierAcceptanceConfirmed: true,
    };
    const saved = await saveShipmentPreparation(pool, sys, id, wh.id, {
      expectedRevision: 1,
      details: complete,
    });
    expect(saved.revision).toBe(2);
    expect(saved.missing).toEqual([]);
    await expect(
      getShipmentPreparation(
        pool,
        { ...sys, request: 'admin', role: 'warehouse_manager', warehouseIds: [] },
        id,
        wh.id,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await whOnHand()).toBe(before);
    expect((await getStockOrder(pool, owner, id)).status).toBe('paid');
    await expect(getShipmentPreparation(pool, owner, id, wh.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      getShipmentPreparation(
        pool,
        stockSystemActor('02000000-0000-4000-8000-000000000002'),
        id,
        wh.id,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('rejects fulfilment when the payment ledger no longer matches the paid order', async () => {
    const id = await paidOrder(`GATE-${S}`, '1');
    await pool.query(
      `update stock.stock_order_payments set amount_paise=amount_paise+1 where stock_order_id=$1`,
      [id],
    );
    const before = await whOnHand();
    await expect(approveStockOrder(pool, sys, id)).rejects.toMatchObject({
      code: 'payment_unverified',
    });
    await expect(allocateStockOrder(pool, sys, id, wh.id)).rejects.toMatchObject({
      code: 'payment_unverified',
    });
    await expect(
      dispatchStockOrder(pool, sys, id, { warehouseId: wh.id, dispatchNumber: `BLOCK-${S}` }),
    ).rejects.toMatchObject({ code: 'payment_unverified' });
    await expect(
      saveShipmentPreparation(pool, sys, id, wh.id, { expectedRevision: 0, details }),
    ).rejects.toMatchObject({ code: 'payment_unverified' });
    expect(await whOnHand()).toBe(before);
    expect(await getShipmentPreparation(pool, sys, id, wh.id)).toBeNull();
  });
});
