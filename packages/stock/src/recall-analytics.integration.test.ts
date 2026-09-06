/**
 * Stock S6 recall + analytics against a real Postgres: recall activation blocks
 * FEFO allocation and identifies holdings, warehouse quarantine, daily
 * consumption rollups, demand-based reorder suggestions, and the combined Owner
 * dashboard. Runs only when STOCK_DATABASE_URL is set.
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
import { createItem, createWarehouse, configureOutletStock, getItemBalances } from './inventory';
import { postMovements, pickFefo } from './ledger';
import { draftRecall, activateRecall, quarantineRecallLocation, getRecall } from './recall';
import {
  generateReorderSuggestions,
  rebuildDailyConsumptionRollups,
  dismissSuggestion,
  getOwnerDashboard,
} from './analytics';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = '66666666-6666-4666-8666-666666666666';
const OUTLET = '77777777-7777-4777-8777-777777777777';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let wh: { id: string; locationIds: Record<string, string> };
let milkId: string;
let sugarId: string;
let outletLoc: string;
let recalledBatchId: string;

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);

  wh = await createWarehouse(pool, sys, {
    organizationId: ORG,
    code: `RWH-${S}`,
    name: `RWH ${S}`,
  });
  milkId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `RMILK-${S}`,
      name: 'Milk',
      itemType: 'raw_material',
      dimension: 'volume',
      baseUnit: 'ml',
      isBatchTracked: true,
    })
  ).id;
  sugarId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `RSUGAR-${S}`,
      name: 'Sugar',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
      orderPack: 1000,
    })
  ).id;
  outletLoc = (
    await configureOutletStock(pool, sys, {
      outletId: OUTLET,
      organizationId: ORG,
      franchiseId: FRANCHISE,
    })
  ).sellableLocationId;

  const batch = await pool.query<{ id: string }>(
    `insert into stock.batches (organization_id, item_id, batch_code, expiry_date, origin)
     values ($1,$2,$3,'2027-01-01','received') returning id`,
    [ORG, milkId, `RB-${S}`],
  );
  recalledBatchId = batch.rows[0]!.id;
  await postMovements(pool, [
    {
      organizationId: ORG,
      stockLocationId: wh.locationIds.sellable!,
      itemId: milkId,
      batchId: recalledBatchId,
      quantity: '4000',
      movementType: 'receipt',
      unitCostPaise: 5,
      sourceDocType: 'test.seed',
      idempotencyKey: `rseed-wh-${S}`,
    },
    {
      organizationId: ORG,
      stockLocationId: outletLoc,
      itemId: milkId,
      batchId: recalledBatchId,
      quantity: '1000',
      movementType: 'transfer_in',
      sourceDocType: 'test.seed',
      idempotencyKey: `rseed-outlet-${S}`,
    },
    {
      organizationId: ORG,
      stockLocationId: outletLoc,
      itemId: sugarId,
      quantity: '200',
      movementType: 'opening',
      sourceDocType: 'test.seed',
      idempotencyKey: `rseed-sugar-${S}`,
    },
  ]);
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Stock recall', () => {
  it('activates a recall, blocks FEFO, and identifies every holding', async () => {
    const draft = await draftRecall(pool, sys, {
      organizationId: ORG,
      itemId: milkId,
      batchId: recalledBatchId,
      reason: 'contamination',
    });
    const res = await activateRecall(pool, sys, draft.id);
    expect(res.affectedLocations).toBe(2);
    expect(Number(res.quantityBase)).toBe(5000);

    const bt = await pool.query<{ status: string }>(
      'select status from stock.batches where id = $1',
      [recalledBatchId],
    );
    expect(bt.rows[0]!.status).toBe('recalled');

    // FEFO at the warehouse now finds nothing for that item (only the recalled batch had stock).
    const picks = await withStockActorContext(pool, stockSystemContext(), (c) =>
      pickFefo(c, wh.locationIds.sellable!, milkId, '100'),
    );
    expect(Number(picks.shortfall)).toBe(100);
    expect(picks.picks).toHaveLength(0);

    const outbox = await pool.query<{ n: string }>(
      `select count(*) as n from stock_outbox.events
        where aggregate_id = $1 and event_type = 'RecallActivated'`,
      [draft.id],
    );
    expect(Number(outbox.rows[0]!.n)).toBe(1);
  });

  it('quarantines the warehouse holding', async () => {
    const recall = await pool.query<{ id: string }>(
      'select id from stock.recalls where batch_id = $1',
      [recalledBatchId],
    );
    const recallId = recall.rows[0]!.id;
    await quarantineRecallLocation(pool, sys, recallId, wh.locationIds.sellable!);

    const whSellable = (await getItemBalances(pool, sys, milkId))
      .filter((r) => r.stockLocationId === wh.locationIds.sellable)
      .reduce((s, r) => s + Number(r.onHand), 0);
    expect(whSellable).toBe(0);
    const whQuarantine = (await getItemBalances(pool, sys, milkId))
      .filter((r) => r.stockLocationId === wh.locationIds.quarantine)
      .reduce((s, r) => s + Number(r.onHand), 0);
    expect(whQuarantine).toBe(4000);

    const summary = await getRecall(pool, sys, recallId);
    expect(Number(summary.quarantinedBase)).toBeGreaterThanOrEqual(4000);
  });
});

describe.skipIf(!RUN)('Stock analytics', () => {
  it('rolls up consumption and produces an explainable reorder suggestion', async () => {
    // Seed a fortnight of sugar consumption directly into the rollup source.
    const sc = await pool.query<{ id: string }>(
      `insert into stock.sale_consumptions
         (organization_id, source_event_id, event_type, outlet_id, business_date, status)
       values ($1,$2,'SaleCompleted',$3, current_date - 3, 'processed') returning id`,
      [ORG, randomUUID(), OUTLET],
    );
    await pool.query(
      `insert into stock.sale_consumption_lines
         (sale_consumption_id, item_id, qty_base) values ($1,$2,$3)`,
      [sc.rows[0]!.id, sugarId, '700'],
    );

    const rollup = await rebuildDailyConsumptionRollups(pool, ORG);
    expect(rollup.rows).toBeGreaterThan(0);

    const gen = await generateReorderSuggestions(pool, sys, {
      organizationId: ORG,
      outletId: OUTLET,
      trailingDays: 14,
      leadTimeDays: 3,
      safetyDays: 2,
    });
    expect(gen.created).toBeGreaterThan(0);

    const sug = await pool.query<{ id: string; suggested_qty_base: string; inputs: unknown }>(
      `select id, suggested_qty_base, inputs from stock.reorder_suggestions
        where outlet_id = $1 and item_id = $2`,
      [OUTLET, sugarId],
    );
    expect(Number(sug.rows[0]!.suggested_qty_base)).toBeGreaterThan(0);
    // Rounded to the 1000 g order pack.
    expect(Number(sug.rows[0]!.suggested_qty_base) % 1000).toBe(0);
    expect(sug.rows[0]!.inputs).toMatchObject({ leadTimeDays: 3, safetyDays: 2 });

    await dismissSuggestion(pool, sys, sug.rows[0]!.id, null);
    const after = await pool.query<{ status: string }>(
      'select status from stock.reorder_suggestions where id = $1',
      [sug.rows[0]!.id],
    );
    expect(after.rows[0]!.status).toBe('dismissed');
  });

  it('builds the combined Owner dashboard from projections', async () => {
    const dash = await getOwnerDashboard(pool, sys, OUTLET);
    expect(dash.outletId).toBe(OUTLET);
    expect(dash.openRecalls).toBeGreaterThanOrEqual(1);
    expect(typeof dash.stockValuePaise).toBe('number');
    expect(dash.pendingLocalInwardReviews).toBeGreaterThanOrEqual(0);
  });
});
