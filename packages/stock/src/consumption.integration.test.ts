/**
 * Stock S5 recipe + Billing-event integration against a real Postgres: recipe
 * publication, the SaleCompleted consumer (FEFO deduction, idempotent replay,
 * negative-stock exceptions), the prepared-base path, SaleRefunded (no
 * restoration), and local inward. Runs only when STOCK_DATABASE_URL is set.
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
import { createItem, configureOutletStock, getItemBalances } from './inventory';
import { postMovements } from './ledger';
import { ingestInboundEvent } from './events';
import { assertRecipePublished, createRecipe, publishRecipeVersion } from './recipes';
import { processSaleCompleted, processSaleRefunded } from './consumption';
import { recordLocalInward, reviewLocalInward } from './local-inward';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = '44444444-4444-4444-8444-444444444444';
const OUTLET = '55555555-5555-4555-8555-555555555555';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let teaPowderId: string;
let cupId: string;
let teaBaseId: string;
let outletLoc: string;
let recipeId: string;

async function outletOnHand(itemId: string): Promise<number> {
  return (await getItemBalances(pool, sys, itemId))
    .filter((r) => r.stockLocationId === outletLoc)
    .reduce((s, r) => s + Number(r.onHand), 0);
}

async function ingestSale(
  eventType: 'SaleCompleted' | 'SaleRefunded',
  payload: unknown,
): Promise<string> {
  const eventId = randomUUID();
  await withStockActorContext(pool, stockSystemContext(), (c) =>
    ingestInboundEvent(c, {
      eventId,
      eventType,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      source: 'billing',
      correlationId: randomUUID(),
      organizationId: ORG,
      franchiseId: FRANCHISE,
      outletId: OUTLET,
      payload,
    }),
  );
  return eventId;
}

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);

  teaPowderId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `CTEA-${S}`,
      name: 'Tea Powder',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
    })
  ).id;
  cupId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `CCUP-${S}`,
      name: 'Cup',
      itemType: 'packaging',
      dimension: 'count',
      baseUnit: 'each',
      supplyRule: 'jksh_required',
    })
  ).id;
  teaBaseId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `CBASE-${S}`,
      name: 'Tea Base',
      itemType: 'intermediate',
      dimension: 'volume',
      baseUnit: 'ml',
    })
  ).id;

  outletLoc = (
    await configureOutletStock(pool, sys, {
      outletId: OUTLET,
      organizationId: ORG,
      franchiseId: FRANCHISE,
    })
  ).sellableLocationId;

  await postMovements(pool, [
    {
      organizationId: ORG,
      stockLocationId: outletLoc,
      itemId: teaPowderId,
      quantity: '100',
      movementType: 'opening',
      sourceDocType: 'test.seed',
      idempotencyKey: `cseed-tea-${S}`,
    },
    {
      organizationId: ORG,
      stockLocationId: outletLoc,
      itemId: cupId,
      quantity: '10',
      movementType: 'opening',
      sourceDocType: 'test.seed',
      idempotencyKey: `cseed-cup-${S}`,
    },
  ]);

  recipeId = (
    await createRecipe(pool, sys, {
      organizationId: ORG,
      kind: 'menu_item',
      billingMenuItemId: randomUUID(),
      name: 'Masala Tea',
    })
  ).id;
  await publishRecipeVersion(pool, sys, recipeId, {
    servingQtyBase: '80',
    servingUnit: 'ml',
    batchYieldBase: '1000',
    components: [
      { componentType: 'fixed', itemId: teaPowderId, qtyBase: '2.4' },
      { componentType: 'packaging', itemId: cupId, qtyBase: '1' },
    ],
  });
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('assertRecipePublished (Billing link guard)', () => {
  it('accepts a real published version and rejects unknown / wrong-kind ones', async () => {
    const ref = await assertRecipePublished(pool, recipeId, 1);
    expect(ref.kind).toBe('menu_item');
    await expect(assertRecipePublished(pool, recipeId, 99)).rejects.toThrow(/not found/i);
    await expect(assertRecipePublished(pool, randomUUID(), 1)).rejects.toThrow(/not found/i);
  });
});

describe.skipIf(!RUN)('Stock sale consumption', () => {
  it('deducts recipe ingredients FEFO and is idempotent on replay', async () => {
    const eventId = await ingestSale('SaleCompleted', {
      billId: randomUUID(),
      outletId: OUTLET,
      receiptNumber: 'R1',
      businessDate: '2026-09-07',
      finalTotal: '30.00',
      lines: [
        {
          billLineId: randomUUID(),
          catalogItemId: randomUUID(),
          quantity: 2,
          stockRecipeId: recipeId,
          stockRecipeVersion: 1,
          addons: [],
        },
      ],
    });
    const res = await processSaleCompleted(pool, eventId);
    expect(res.status).toBe('processed');
    expect(await outletOnHand(teaPowderId)).toBeCloseTo(100 - 4.8, 4);
    expect(await outletOnHand(cupId)).toBe(8);

    const replay = await processSaleCompleted(pool, eventId);
    expect(replay.duplicate).toBe(true);
    expect(await outletOnHand(teaPowderId)).toBeCloseTo(100 - 4.8, 4);
  });

  it('records a negative-stock exception without rejecting the sale', async () => {
    const eventId = await ingestSale('SaleCompleted', {
      billId: randomUUID(),
      outletId: OUTLET,
      receiptNumber: 'R2',
      businessDate: '2026-09-07',
      finalTotal: '1500.00',
      lines: [
        {
          billLineId: randomUUID(),
          catalogItemId: randomUUID(),
          quantity: 100,
          stockRecipeId: recipeId,
          stockRecipeVersion: 1,
          addons: [],
        },
      ],
    });
    const res = await processSaleCompleted(pool, eventId);
    expect(res.status).toBe('negative_exception');
    expect(res.negativeExceptions).toBeGreaterThan(0);
    expect(await outletOnHand(teaPowderId)).toBeLessThan(0);
  });

  it('consumes a recorded prepared base instead of the raw recipe', async () => {
    await publishRecipeVersion(pool, sys, recipeId, {
      servingQtyBase: '80',
      servingUnit: 'ml',
      preparedBaseItemId: teaBaseId,
      preparedBaseQtyBase: '80',
      components: [{ componentType: 'fixed', itemId: teaPowderId, qtyBase: '2.4' }],
    });
    // Record 500 ml of prepared tea base at the outlet.
    await pool.query(
      `insert into stock.prepared_batches
         (organization_id, stock_location_id, outlet_id, item_id, qty_base_initial, qty_base_remaining)
       values ($1,$2,$3,$4,500,500)`,
      [ORG, outletLoc, OUTLET, teaBaseId],
    );
    const teaBefore = await outletOnHand(teaPowderId);
    const eventId = await ingestSale('SaleCompleted', {
      billId: randomUUID(),
      outletId: OUTLET,
      receiptNumber: 'R3',
      businessDate: '2026-09-07',
      finalTotal: '90.00',
      lines: [
        {
          billLineId: randomUUID(),
          catalogItemId: randomUUID(),
          quantity: 3,
          stockRecipeId: recipeId,
          stockRecipeVersion: 2,
          addons: [],
        },
      ],
    });
    await processSaleCompleted(pool, eventId);
    // Raw tea powder untouched; 240 ml of prepared base consumed.
    expect(await outletOnHand(teaPowderId)).toBeCloseTo(teaBefore, 4);
    const prep = await pool.query<{ qty_base_remaining: string }>(
      'select qty_base_remaining from stock.prepared_batches where item_id = $1',
      [teaBaseId],
    );
    expect(Number(prep.rows[0]!.qty_base_remaining)).toBe(260);
  });

  it('never restores materials on a refund', async () => {
    const teaBefore = await outletOnHand(teaPowderId);
    const eventId = await ingestSale('SaleRefunded', {
      refundId: randomUUID(),
      billId: randomUUID(),
      kind: 'full',
      amount: '30.00',
      lines: [
        { billLineId: randomUUID(), quantity: 1, wastageClassification: 'customer_cancelled' },
      ],
    });
    const res = await processSaleRefunded(pool, eventId);
    expect(res.duplicate).toBe(false);
    expect(await outletOnHand(teaPowderId)).toBeCloseTo(teaBefore, 4);
  });
});

describe.skipIf(!RUN)('Stock local inward', () => {
  it('blocks JKSH-required items and flags a cost-pending entry', async () => {
    await expect(
      recordLocalInward(pool, sys, {
        organizationId: ORG,
        outletId: OUTLET,
        franchiseId: FRANCHISE,
        itemId: cupId,
        qtyBase: '50',
      }),
    ).rejects.toThrow(/JKSH-required/i);

    const before = await outletOnHand(teaPowderId);
    const li = await recordLocalInward(pool, sys, {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      itemId: teaPowderId,
      qtyBase: '500',
    });
    expect(li.valuationState).toBe('cost_pending');
    expect(await outletOnHand(teaPowderId)).toBeCloseTo(before + 500, 4);

    const reviewed = await reviewLocalInward(pool, sys, li.id, {
      action: 'confirm',
      unitCostPaise: 40,
      supplierName: 'Local Dairy',
    });
    expect(reviewed.status).toBe('confirmed');
    const row = await pool.query<{ valuation_state: string }>(
      'select valuation_state from stock.local_inwards where id = $1',
      [li.id],
    );
    expect(row.rows[0]!.valuation_state).toBe('costed');
  });
});
