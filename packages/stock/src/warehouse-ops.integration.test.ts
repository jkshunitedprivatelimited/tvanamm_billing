/**
 * Stock S3 (part 2) warehouse operations against a real Postgres: production
 * with batch genealogy, physical counts with the second-approver rule, wastage,
 * JKSH-owned transfers (and the franchise-outlet block), and document reversal.
 * Runs only when STOCK_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, createWarehouse, configureOutletStock, getItemBalances } from './inventory';
import { postMovements } from './ledger';
import {
  approveCountAdjustments,
  createProductionOrder,
  createTransfer,
  dispatchTransfer,
  enterCountLine,
  issueProductionMaterials,
  openStockCount,
  postProduction,
  receiveTransfer,
  recordProductionOutput,
  recordWastage,
  reverseDocument,
  submitCountForReview,
} from './warehouse-ops';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let wh1: { id: string; locationIds: Record<string, string> };
let wh2: { id: string; locationIds: Record<string, string> };
let teaId: string;
let teaBaseId: string;

const managerA: () => StockActor = () => ({
  request: 'admin',
  role: 'warehouse_manager',
  accountId: '000000aa-0000-4000-8000-0000000000a1',
  organizationId: ORG,
  warehouseIds: [wh1.id, wh2.id],
});
const managerB: () => StockActor = () => ({
  ...managerA(),
  accountId: '000000bb-0000-4000-8000-0000000000b2',
});

async function onHand(itemId: string, locId: string): Promise<number> {
  const rows = await getItemBalances(pool, sys, itemId);
  return rows.filter((r) => r.stockLocationId === locId).reduce((s, r) => s + Number(r.onHand), 0);
}

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);

  wh1 = await createWarehouse(pool, sys, { organizationId: ORG, code: `W1-${S}`, name: `W1 ${S}` });
  wh2 = await createWarehouse(pool, sys, { organizationId: ORG, code: `W2-${S}`, name: `W2 ${S}` });

  teaId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `WTEA-${S}`,
      name: 'Tea Powder',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
      isBatchTracked: true,
    })
  ).id;
  teaBaseId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `WTEABASE-${S}`,
      name: 'Tea Base',
      itemType: 'intermediate',
      dimension: 'volume',
      baseUnit: 'ml',
      isBatchTracked: true,
    })
  ).id;

  // Seed raw tea in WH1 sellable with a batch.
  const batch = await pool.query<{ id: string }>(
    `insert into stock.batches (organization_id, item_id, batch_code, expiry_date, origin)
     values ($1,$2,$3,'2027-06-01','received') returning id`,
    [ORG, teaId, `WB-${S}`],
  );
  await postMovements(pool, [
    {
      organizationId: ORG,
      stockLocationId: wh1.locationIds.sellable!,
      itemId: teaId,
      batchId: batch.rows[0]!.id,
      quantity: '5000',
      movementType: 'receipt',
      unitCostPaise: 40,
      sourceDocType: 'test.seed',
      idempotencyKey: `wseed-${S}`,
    },
  ]);
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Stock warehouse operations', () => {
  it('runs production and links output batch genealogy to an input lot', async () => {
    const before = await onHand(teaId, wh1.locationIds.sellable!);
    const po = await createProductionOrder(pool, sys, {
      organizationId: ORG,
      warehouseId: wh1.id,
      outputItemId: teaBaseId,
      plannedQtyBase: '2000',
    });
    await issueProductionMaterials(pool, sys, po.id, [{ itemId: teaId, qtyBase: '600' }]);
    expect(await onHand(teaId, wh1.locationIds.sellable!)).toBe(before - 600);

    const out = await recordProductionOutput(pool, sys, po.id, {
      outputBatchCode: `TB-${S}`,
      expiryDate: '2026-09-10',
      acceptedQtyBase: '1900',
      rejectedQtyBase: '50',
    });
    await postProduction(pool, sys, po.id);

    expect(await onHand(teaBaseId, wh1.locationIds.sellable!)).toBe(1900);
    const genealogy = await pool.query<{ parent_batch_id: string | null }>(
      'select parent_batch_id from stock.batches where id = $1',
      [out.outputBatchId],
    );
    expect(genealogy.rows[0]!.parent_batch_id).not.toBeNull();
    const order = await pool.query<{ status: string; loss_qty_base: string }>(
      'select status, loss_qty_base from stock.production_orders where id = $1',
      [po.id],
    );
    expect(order.rows[0]!.status).toBe('posted');
    expect(Number(order.rows[0]!.loss_qty_base)).toBe(50);
  });

  it('enforces the second-approver rule and posts variance adjustments', async () => {
    const loc = wh2.locationIds.sellable!;
    const sugarId = (
      await createItem(pool, sys, {
        organizationId: ORG,
        sku: `WSUGAR-${S}`,
        name: 'Sugar',
        itemType: 'raw_material',
        dimension: 'mass',
        baseUnit: 'g',
      })
    ).id;
    await postMovements(pool, [
      {
        organizationId: ORG,
        stockLocationId: loc,
        itemId: sugarId,
        quantity: '1000',
        movementType: 'opening',
        sourceDocType: 'test.seed',
        idempotencyKey: `wsug-${S}`,
      },
    ]);

    const count = await openStockCount(pool, managerA(), {
      organizationId: ORG,
      stockLocationId: loc,
      countType: 'full',
      periodLabel: '2026-09',
    });
    const line = await enterCountLine(pool, managerA(), count.id, {
      itemId: sugarId,
      countedQtyBase: '940',
      reason: 'spillage',
    });
    expect(Number(line.varianceQtyBase)).toBe(-60);

    await submitCountForReview(pool, managerA(), count.id);
    await expect(approveCountAdjustments(pool, managerA(), count.id)).rejects.toThrow(
      /cannot approve their own/i,
    );

    const res = await approveCountAdjustments(pool, managerB(), count.id);
    expect(res.adjustments).toBe(1);
    expect(await onHand(sugarId, loc)).toBe(940);
  });

  it('records wastage as a negative movement and reverses it as a new document', async () => {
    const loc = wh1.locationIds.sellable!;
    const before = await onHand(teaBaseId, loc);
    const waste = await recordWastage(pool, sys, {
      organizationId: ORG,
      stockLocationId: loc,
      itemId: teaBaseId,
      qtyBase: '200',
      reason: 'spoilage',
    });
    expect(await onHand(teaBaseId, loc)).toBe(before - 200);

    const rev = await reverseDocument(pool, sys, {
      organizationId: ORG,
      sourceDocType: 'wastage_event',
      sourceDocId: waste.id,
      reason: 'recorded against the wrong item',
    });
    expect(rev.reversedMovements).toBe(1);
    expect(await onHand(teaBaseId, loc)).toBe(before);

    await expect(
      reverseDocument(pool, sys, {
        organizationId: ORG,
        sourceDocType: 'wastage_event',
        sourceDocId: waste.id,
        reason: 'again',
      }),
    ).rejects.toThrow(/already reversed/i);
  });

  it('moves stock between JKSH warehouses via in-transit and blocks a franchise outlet', async () => {
    const outlet = await configureOutletStock(pool, sys, {
      outletId: '000000cc-0000-4000-8000-0000000000c3',
      organizationId: ORG,
      franchiseId: '000000dd-0000-4000-8000-0000000000d4',
    });
    await expect(
      createTransfer(pool, sys, {
        organizationId: ORG,
        fromLocationId: wh1.locationIds.sellable!,
        toLocationId: outlet.sellableLocationId,
        transferNumber: `TR-BAD-${S}`,
        lines: [{ itemId: teaId, qtyBase: '10' }],
      }),
    ).rejects.toThrow(/JKSH-owned/i);

    const fromBefore = await onHand(teaId, wh1.locationIds.sellable!);
    const transfer = await createTransfer(pool, sys, {
      organizationId: ORG,
      fromLocationId: wh1.locationIds.sellable!,
      toLocationId: wh2.locationIds.sellable!,
      transferNumber: `TR-${S}`,
      lines: [{ itemId: teaId, qtyBase: '900' }],
    });
    await dispatchTransfer(pool, sys, transfer.id);
    expect(await onHand(teaId, wh1.locationIds.sellable!)).toBe(fromBefore - 900);
    expect(await onHand(teaId, wh1.locationIds.in_transit!)).toBe(900);

    const lineId = (
      await pool.query<{ id: string }>(
        'select id from stock.stock_transfer_lines where stock_transfer_id = $1',
        [transfer.id],
      )
    ).rows[0]!.id;
    const result = await receiveTransfer(pool, sys, transfer.id, [
      { lineId, acceptedQtyBase: '880', damagedQtyBase: '20' },
    ]);
    expect(result.status).toBe('received');
    expect(await onHand(teaId, wh1.locationIds.in_transit!)).toBe(0);
    expect(await onHand(teaId, wh2.locationIds.sellable!)).toBe(880);
    expect(await onHand(teaId, wh2.locationIds.damaged!)).toBe(20);
  });
});
