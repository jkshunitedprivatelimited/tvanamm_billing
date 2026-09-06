/**
 * Stock S3 procurement against a real Postgres: purchase orders, receiving with
 * the mandatory supplier invoice number gate, receipt posting to the ledger,
 * idempotency, supplier invoices with a payment-derived state, and supplier
 * returns. Runs only when STOCK_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, createWarehouse, getItemBalances } from './inventory';
import {
  approveSupplier,
  createPurchaseOrder,
  createSupplier,
  createSupplierInvoice,
  getSupplierInvoice,
  initiateSupplierReturn,
  confirmSupplierReturnDispatch,
  recordSupplierPayment,
  receiveSupplierShipment,
  resolveSupplierReturn,
  transitionPurchaseOrder,
} from './procurement';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let warehouseId: string;
let sellableLocId: string;
let damagedLocId: string;
let milkItemId: string;
let supplierId: string;

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);

  const wh = await createWarehouse(pool, sys, {
    organizationId: ORG,
    code: `PWH-${S}`,
    name: `Proc WH ${S}`,
  });
  warehouseId = wh.id;
  sellableLocId = wh.locationIds.sellable!;
  damagedLocId = wh.locationIds.damaged!;

  milkItemId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `MILK-${S}`,
      name: 'Milk',
      itemType: 'raw_material',
      dimension: 'volume',
      baseUnit: 'ml',
      supplyRule: 'local_purchase',
      isBatchTracked: true,
    })
  ).id;

  supplierId = (await createSupplier(pool, sys, { organizationId: ORG, name: `Dairy Co ${S}` })).id;
  await approveSupplier(pool, sys, supplierId);
});

afterAll(async () => {
  if (RUN) await pool.end();
});

async function balanceAt(locId: string): Promise<number> {
  const rows = await getItemBalances(pool, sys, milkItemId);
  return rows.filter((r) => r.stockLocationId === locId).reduce((s, r) => s + Number(r.onHand), 0);
}

describe.skipIf(!RUN)('Stock procurement', () => {
  let poId: string;

  it('creates a purchase order with computed GST-inclusive totals', async () => {
    const po = await createPurchaseOrder(pool, sys, {
      organizationId: ORG,
      supplierId,
      warehouseId,
      poNumber: `PO-${S}`,
      lines: [{ itemId: milkItemId, orderQtyBase: '10000', unitPricePaise: 5, gstRate: 5 }],
    });
    // 10000 * 5 = 50000 paise net; +5% GST = 2500; total 52500
    expect(po.totalPaise).toBe(52500);
    poId = po.id;
    await transitionPurchaseOrder(pool, sys, poId, 'submit');
    await transitionPurchaseOrder(pool, sys, poId, 'approve');
    const { status } = await transitionPurchaseOrder(pool, sys, poId, 'order');
    expect(status).toBe('ordered');
  });

  it('keeps a receipt in draft and posts nothing without a supplier invoice number', async () => {
    const before = await balanceAt(sellableLocId);
    const res = await receiveSupplierShipment(pool, sys, {
      organizationId: ORG,
      purchaseOrderId: poId,
      warehouseId,
      receiptNumber: `RC-${S}-draft`,
      idempotencyKey: `rc-${S}-draft`,
      lines: [
        { itemId: milkItemId, batchCode: `MB-${S}-d`, acceptedQtyBase: '4000', unitCostPaise: 5 },
      ],
    });
    expect(res.status).toBe('draft');
    expect(await balanceAt(sellableLocId)).toBe(before);
  });

  it('posts accepted and damaged quantities when the invoice number is present', async () => {
    const beforeSellable = await balanceAt(sellableLocId);
    const beforeDamaged = await balanceAt(damagedLocId);
    const res = await receiveSupplierShipment(pool, sys, {
      organizationId: ORG,
      purchaseOrderId: poId,
      warehouseId,
      receiptNumber: `RC-${S}-1`,
      idempotencyKey: `rc-${S}-1`,
      supplierInvoiceNumber: `INV-${S}`,
      invoiceDate: '2026-09-01',
      lines: [
        {
          purchaseOrderLineId: null,
          itemId: milkItemId,
          batchCode: `MB-${S}-1`,
          expiryDate: '2026-09-20',
          acceptedQtyBase: '9000',
          damagedQtyBase: '500',
          rejectedQtyBase: '500',
          unitCostPaise: 5,
        },
      ],
    });
    expect(res.status).toBe('posted');
    expect(await balanceAt(sellableLocId)).toBe(beforeSellable + 9000);
    expect(await balanceAt(damagedLocId)).toBe(beforeDamaged + 500);

    const val = await pool.query<{ avg: string; qty: string }>(
      'select avg_cost_paise as avg, on_hand_qty as qty from stock.item_valuation where item_id = $1',
      [milkItemId],
    );
    expect(Number(val.rows[0]!.avg)).toBeCloseTo(5, 4);
    expect(Number(val.rows[0]!.qty)).toBe(9500);
  });

  it('is idempotent on a duplicate receive command', async () => {
    const before = await balanceAt(sellableLocId);
    const again = await receiveSupplierShipment(pool, sys, {
      organizationId: ORG,
      purchaseOrderId: poId,
      warehouseId,
      receiptNumber: `RC-${S}-1`,
      idempotencyKey: `rc-${S}-1`,
      supplierInvoiceNumber: `INV-${S}`,
      lines: [
        { itemId: milkItemId, batchCode: `MB-${S}-1`, acceptedQtyBase: '9000', unitCostPaise: 5 },
      ],
    });
    expect(again.duplicate).toBe(true);
    expect(await balanceAt(sellableLocId)).toBe(before);
  });

  it('derives supplier-invoice payable state from immutable payments', async () => {
    const inv = await createSupplierInvoice(pool, sys, {
      organizationId: ORG,
      supplierId,
      invoiceNumber: `SINV-${S}`,
      invoiceDate: '2026-09-01',
      dueDate: '2026-09-30',
      amountPaise: 10000,
    });
    let paid = await recordSupplierPayment(pool, sys, {
      organizationId: ORG,
      supplierInvoiceId: inv.id,
      amountPaise: 4000,
      method: 'bank_transfer',
      paidOn: '2026-09-05',
    });
    expect(paid.state).toBe('partially_paid');
    paid = await recordSupplierPayment(pool, sys, {
      organizationId: ORG,
      supplierInvoiceId: inv.id,
      amountPaise: 6000,
      method: 'upi',
      paidOn: '2026-09-06',
    });
    expect(paid.state).toBe('paid');
    const view = await getSupplierInvoice(pool, sys, inv.id);
    expect(view.paidPaise).toBe(10000);
    expect(view.state).toBe('paid');
  });

  it('moves eligible quantity to quarantine on a supplier return and out on dispatch', async () => {
    const beforeSellable = await balanceAt(sellableLocId);
    const ret = await initiateSupplierReturn(pool, sys, {
      organizationId: ORG,
      supplierId,
      warehouseId,
      itemId: milkItemId,
      quantityBase: '1000',
      reason: 'quality_failed',
    });
    expect(await balanceAt(sellableLocId)).toBe(beforeSellable - 1000);

    const quarantine = await pool.query<{ id: string }>(
      `select id from stock.stock_locations where warehouse_id = $1 and kind = 'quarantine'`,
      [warehouseId],
    );
    const qLoc = quarantine.rows[0]!.id;
    const qBefore = (await getItemBalances(pool, sys, milkItemId))
      .filter((r) => r.stockLocationId === qLoc)
      .reduce((s, r) => s + Number(r.onHand), 0);
    expect(qBefore).toBe(1000);

    await confirmSupplierReturnDispatch(pool, sys, ret.id);
    const qAfter = (await getItemBalances(pool, sys, milkItemId))
      .filter((r) => r.stockLocationId === qLoc)
      .reduce((s, r) => s + Number(r.onHand), 0);
    expect(qAfter).toBe(0);

    await resolveSupplierReturn(pool, sys, ret.id, 'credit_note');
    const row = await pool.query<{ status: string; resolution: string }>(
      'select status, resolution from stock.supplier_returns where id = $1',
      [ret.id],
    );
    expect(row.rows[0]).toEqual({ status: 'resolved', resolution: 'credit_note' });
  });
});
