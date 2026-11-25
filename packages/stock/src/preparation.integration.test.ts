/**
 * Prepared-base posting (stock migration 0026) against a real Postgres:
 * scaled raw issue, idempotent retry, sale draws from the base without
 * touching raw stock again, discard of leftovers, and outlet scoping.
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
import { createItem, configureOutletStock, getItemBalances } from './inventory';
import { postMovements } from './ledger';
import { ingestInboundEvent } from './events';
import { createRecipe, publishRecipeVersion } from './recipes';
import { processSaleCompleted } from './consumption';
import {
  discardPreparedBatch,
  listPreparationRecipes,
  listPreparedBatches,
  recordPreparedBatch,
} from './preparation';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = randomUUID();
const OUTLET = randomUUID();
const OTHER_FRANCHISE = randomUUID();
const OTHER_OUTLET = randomUUID();
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let employee: StockActor;
let milkId: string;
let teaId: string;
let sugarId: string;
let cupId: string;
let baseId: string;
let outletLoc: string;
let prepRecipeId: string;
let saleRecipeId: string;

async function onHand(itemId: string, loc = outletLoc): Promise<number> {
  return (await getItemBalances(pool, sys, itemId))
    .filter((r) => r.stockLocationId === loc)
    .reduce((s, r) => s + Number(r.onHand), 0);
}

async function item(name: string, itemType: string, dimension: string, baseUnit: string) {
  return (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `PREP-${name}-${S}`,
      name: `${name} ${S}`,
      itemType: itemType as 'raw_material',
      dimension: dimension as 'mass',
      baseUnit: baseUnit as 'g',
    })
  ).id;
}

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);
  employee = {
    request: 'operator',
    role: 'store_employee',
    organizationId: ORG,
    franchiseId: FRANCHISE,
    outletId: OUTLET,
    employeeId: randomUUID(),
    warehouseIds: [],
  };

  milkId = await item('Milk', 'raw_material', 'volume', 'ml');
  teaId = await item('TeaPowder', 'raw_material', 'mass', 'g');
  sugarId = await item('Sugar', 'raw_material', 'mass', 'g'); // never counted
  cupId = await item('Cup', 'packaging', 'count', 'each');
  baseId = await item('TeaBase', 'intermediate', 'volume', 'ml');

  outletLoc = (
    await configureOutletStock(pool, sys, {
      outletId: OUTLET,
      organizationId: ORG,
      franchiseId: FRANCHISE,
    })
  ).sellableLocationId;
  await configureOutletStock(pool, sys, {
    outletId: OTHER_OUTLET,
    organizationId: ORG,
    franchiseId: OTHER_FRANCHISE,
  });

  const seed = (itemId: string, quantity: string) => ({
    organizationId: ORG,
    stockLocationId: outletLoc,
    itemId,
    quantity,
    movementType: 'opening',
    sourceDocType: 'test.seed',
    idempotencyKey: `prep-seed-${itemId}`,
  });
  await postMovements(pool, [seed(milkId, '5000'), seed(teaId, '100'), seed(cupId, '50')]);

  // 1 litre of base = 800 ml milk + 30 g tea powder + 40 g sugar.
  prepRecipeId = (
    await createRecipe(pool, sys, {
      organizationId: ORG,
      kind: 'intermediate',
      outputItemId: baseId,
      name: `Tea base ${S}`,
    })
  ).id;
  await publishRecipeVersion(pool, sys, prepRecipeId, {
    servingQtyBase: '1000',
    servingUnit: 'ml',
    batchYieldBase: '1000',
    components: [
      { componentType: 'fixed', itemId: milkId, qtyBase: '800' },
      { componentType: 'fixed', itemId: teaId, qtyBase: '30' },
      { componentType: 'fixed', itemId: sugarId, qtyBase: '40' },
    ],
  });

  // A cup of tea is 80 ml of base; without base it would use raw milk + tea.
  saleRecipeId = (
    await createRecipe(pool, sys, {
      organizationId: ORG,
      kind: 'menu_item',
      billingMenuItemId: randomUUID(),
      name: `Tea ${S}`,
    })
  ).id;
  await publishRecipeVersion(pool, sys, saleRecipeId, {
    servingQtyBase: '80',
    servingUnit: 'ml',
    preparedBaseItemId: baseId,
    preparedBaseQtyBase: '80',
    components: [
      { componentType: 'fixed', itemId: milkId, qtyBase: '64' },
      { componentType: 'fixed', itemId: teaId, qtyBase: '2.4' },
      { componentType: 'packaging', itemId: cupId, qtyBase: '1' },
    ],
  });
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Prepared-base posting', () => {
  it('lists the published preparation recipe for the outlet', async () => {
    const recipes = await listPreparationRecipes(pool, employee);
    const mine = recipes.find((r) => r.recipeId === prepRecipeId);
    expect(mine?.outputItemId).toBe(baseId);
    expect(Number(mine?.servingQtyBase)).toBe(1000);
    expect(mine?.components).toHaveLength(3);
  });

  let batchId = '';
  const submissionId = randomUUID();

  it('issues scaled raw inputs once and opens a prepared batch', async () => {
    const milkBefore = await onHand(milkId);
    const teaBefore = await onHand(teaId);
    const cmd = { submissionId, outletId: OUTLET, recipeId: prepRecipeId, outputQtyBase: '2000' };
    const res = await recordPreparedBatch(pool, employee, cmd);
    batchId = res.id;
    expect(res.duplicate).toBe(false);
    expect(res.recipeVersion).toBe(1);
    const byItem = Object.fromEntries(res.inputs.map((i) => [i.itemId, i]));
    expect(Number(byItem[milkId]?.qtyBase)).toBe(1600);
    expect(Number(byItem[teaId]?.qtyBase)).toBe(60);
    // Sugar was never counted at this outlet: recorded, not issued.
    expect(byItem[sugarId]?.skippedUntracked).toBe(true);
    expect(await onHand(milkId)).toBeCloseTo(milkBefore - 1600, 4);
    expect(await onHand(teaId)).toBeCloseTo(teaBefore - 60, 4);
    expect(await onHand(sugarId)).toBe(0);
    expect(await onHand(baseId)).toBeCloseTo(2000, 4);

    // Retry after a lost response: same batch, nothing issued again.
    const again = await recordPreparedBatch(pool, employee, cmd);
    expect(again).toMatchObject({ id: batchId, duplicate: true });
    expect(await onHand(milkId)).toBeCloseTo(milkBefore - 1600, 4);
    await expect(
      recordPreparedBatch(pool, employee, { ...cmd, outputQtyBase: '3000' }),
    ).rejects.toThrow(/different details/);
  });

  it('serializes concurrent duplicate submissions', async () => {
    const milkBefore = await onHand(milkId);
    const cmd = {
      submissionId: randomUUID(),
      outletId: OUTLET,
      recipeId: prepRecipeId,
      outputQtyBase: '500',
    };
    const results = await Promise.all([
      recordPreparedBatch(pool, employee, cmd),
      recordPreparedBatch(pool, employee, cmd),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => r.duplicate)).toHaveLength(1);
    expect(await onHand(milkId)).toBeCloseTo(milkBefore - 400, 4);
  });

  it('sales draw from the prepared base, not raw stock', async () => {
    const milkBefore = await onHand(milkId);
    const teaBefore = await onHand(teaId);
    const cupsBefore = await onHand(cupId);
    const eventId = randomUUID();
    await withStockActorContext(pool, stockSystemContext(), (c) =>
      ingestInboundEvent(c, {
        eventId,
        eventType: 'SaleCompleted',
        eventVersion: 1,
        occurredAt: new Date(Date.now() + 1000).toISOString(),
        source: 'billing',
        correlationId: randomUUID(),
        organizationId: ORG,
        franchiseId: FRANCHISE,
        outletId: OUTLET,
        payload: {
          billId: randomUUID(),
          outletId: OUTLET,
          receiptNumber: `P-${S}`,
          businessDate: new Date().toISOString().slice(0, 10),
          finalTotal: '60.00',
          lines: [
            {
              billLineId: randomUUID(),
              catalogItemId: randomUUID(),
              quantity: 3,
              stockRecipeId: saleRecipeId,
              stockRecipeVersion: 1,
              addons: [],
            },
          ],
        },
      }),
    );
    await processSaleCompleted(pool, eventId);
    expect(await onHand(milkId)).toBeCloseTo(milkBefore, 4);
    expect(await onHand(teaId)).toBeCloseTo(teaBefore, 4);
    expect(await onHand(cupId)).toBeCloseTo(cupsBefore - 3, 4);
    expect(await onHand(baseId)).toBeCloseTo(2500 - 240, 4);
  });

  it('discards leftovers so later sales stop drawing from them', async () => {
    const batches = await listPreparedBatches(pool, employee, OUTLET);
    const first = batches.find((b) => b.id === batchId);
    expect(Number(first?.qtyBaseRemaining)).toBe(1760);

    const submission = randomUUID();
    const partial = await discardPreparedBatch(pool, employee, {
      submissionId: submission,
      outletId: OUTLET,
      preparedBatchId: batchId,
      qtyBase: '260',
      reason: 'Spilled',
    });
    expect(Number(partial.remainingBase)).toBe(1500);
    const replay = await discardPreparedBatch(pool, employee, {
      submissionId: submission,
      outletId: OUTLET,
      preparedBatchId: batchId,
      qtyBase: '260',
      reason: 'Spilled',
    });
    expect(replay.duplicate).toBe(true);
    await expect(
      discardPreparedBatch(pool, employee, {
        submissionId: randomUUID(),
        outletId: OUTLET,
        preparedBatchId: batchId,
        qtyBase: '5000',
        reason: 'Too much',
      }),
    ).rejects.toThrow(/Only 1500/);

    const rest = await discardPreparedBatch(pool, employee, {
      submissionId: randomUUID(),
      outletId: OUTLET,
      preparedBatchId: batchId,
      reason: 'End of day',
    });
    expect(Number(rest.qtyBase)).toBe(1500);
    expect(Number(rest.remainingBase)).toBe(0);
    expect(await onHand(baseId)).toBeCloseTo(2260 - 1760, 4);
  });

  it('keeps each outlet to its own batches', async () => {
    const outsider: StockActor = { ...employee, outletId: OTHER_OUTLET };
    await expect(listPreparedBatches(pool, outsider, OUTLET)).rejects.toThrow(/Not your terminal/);
    await expect(
      recordPreparedBatch(pool, employee, {
        submissionId: randomUUID(),
        outletId: OTHER_OUTLET,
        recipeId: prepRecipeId,
        outputQtyBase: '1000',
      }),
    ).rejects.toThrow(/Not your terminal/);
    const owner: StockActor = {
      request: 'admin',
      role: 'franchise_owner',
      organizationId: ORG,
      franchiseId: OTHER_FRANCHISE,
      warehouseIds: [],
    };
    await expect(listPreparedBatches(pool, owner, OUTLET)).rejects.toThrow(/not in your franchise/);
    await expect(
      discardPreparedBatch(
        pool,
        { ...employee, outletId: OTHER_OUTLET },
        {
          submissionId: randomUUID(),
          outletId: OTHER_OUTLET,
          preparedBatchId: batchId,
          reason: 'x',
        },
      ),
    ).rejects.toThrow(/not found at this outlet/);
  });

  it('scales by the serving size the editor stores quantities against', async () => {
    // Editor "per serving" basis: 250 ml of base uses 200 ml milk.
    const r = await createRecipe(pool, sys, {
      organizationId: ORG,
      kind: 'intermediate',
      outputItemId: baseId,
      name: `Small base ${S}`,
    });
    await publishRecipeVersion(pool, sys, r.id, {
      servingQtyBase: '250',
      servingUnit: 'ml',
      components: [{ componentType: 'fixed', itemId: milkId, qtyBase: '200' }],
    });
    const res = await recordPreparedBatch(pool, employee, {
      submissionId: randomUUID(),
      outletId: OUTLET,
      recipeId: r.id,
      outputQtyBase: '1000',
    });
    expect(Number(res.inputs[0]?.qtyBase)).toBe(800);
  });

  it('refuses a menu-item recipe as a preparation', async () => {
    await expect(
      recordPreparedBatch(pool, employee, {
        submissionId: randomUUID(),
        outletId: OUTLET,
        recipeId: saleRecipeId,
        outputQtyBase: '1000',
      }),
    ).rejects.toThrow(/not published/);
  });
});
