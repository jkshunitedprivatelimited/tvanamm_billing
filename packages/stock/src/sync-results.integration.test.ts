/**
 * Billing ⇄ Stock result loop and outlet-day reconciliation against real
 * Billing and Stock databases. Drives the relay functions directly with an
 * explicit scope (not the shared feature flags other suites toggle).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, createStockPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor } from './authorize';
import { createItem, configureOutletStock } from './inventory';
import { saveOpeningStock } from './opening-stock';
import { createRecipe, publishRecipeVersion } from './recipes';
import { deliverBillingEventsToStock, processStockInbox } from './relay';
import { consumeStockResults, reconcileOutletDay } from './sync-results';

const RUN = !!process.env.DATABASE_URL && !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const DAY = '2026-11-20';
const sys = stockSystemActor(ORG);
let billing: Pool;
let stock: Pool;
let outletId: string;
let franchiseId: string;
let recipeId: string;

beforeAll(async () => {
  if (!RUN) return;
  billing = createPool();
  stock = createStockPool();
  await migrate(billing);
  await stockMigrate(stock);
  const brand = randomUUID();
  franchiseId = randomUUID();
  outletId = randomUUID();
  await billing.query(
    "insert into billing.brands(id,organization_id,slug,name) values($1,$2,$3,'TEST Sync Brand')",
    [brand, ORG, `test-sync-${brand}`],
  );
  await billing.query(
    "insert into billing.franchises(id,organization_id,brand_id,name,slug) values($1,$2,$3,'TEST Sync Franchise',$4)",
    [franchiseId, ORG, brand, `test-sync-${franchiseId}`],
  );
  await billing.query(
    `insert into billing.outlets(id,organization_id,brand_id,franchise_id,ownership_type,status,display_name,slug,billing_enabled)
     values($1,$2,$3,$4,'franchise_owned','active','TEST Sync Outlet',$5,true)`,
    [outletId, ORG, brand, franchiseId, `test-sync-${outletId}`],
  );
  const milk = await createItem(stock, sys, {
    organizationId: ORG,
    sku: `SYNC-MILK-${randomUUID()}`,
    name: 'TEST Sync Milk',
    itemType: 'raw_material',
    dimension: 'volume',
    baseUnit: 'ml',
    supplyRule: 'local_purchase',
  });
  await configureOutletStock(stock, sys, { outletId, organizationId: ORG, franchiseId });
  await saveOpeningStock(stock, sys, outletId, { lines: [{ itemId: milk.id, quantity: '150' }] });
  recipeId = (
    await createRecipe(stock, sys, { organizationId: ORG, kind: 'menu_item', name: 'TEST Sync' })
  ).id;
  await publishRecipeVersion(stock, sys, recipeId, {
    servingQtyBase: '100',
    servingUnit: 'ml',
    components: [{ componentType: 'fixed', itemId: milk.id, qtyBase: '100' }],
  });
});

afterAll(async () => {
  if (RUN) await Promise.all([billing.end(), stock.end()]);
});

async function sale(receipt: string, quantity: number, version = 1, businessDate = DAY) {
  const id = randomUUID();
  const billId = randomUUID();
  await billing.query(
    `insert into outbox.events(id,event_type,aggregate_id,organization_id,franchise_id,outlet_id,correlation_id,idempotency_key,payload)
     values($1::uuid,'SaleCompleted',$2,$3,$4,$5,$6,$1::text,$7)`,
    [
      id,
      billId,
      ORG,
      franchiseId,
      outletId,
      randomUUID(),
      JSON.stringify({
        billId,
        outletId,
        receiptNumber: receipt,
        businessDate,
        finalTotal: '20.00',
        lines: [
          {
            billLineId: randomUUID(),
            catalogItemId: randomUUID(),
            quantity,
            stockRecipeId: recipeId,
            stockRecipeVersion: version,
            addons: [],
          },
        ],
      }),
    ],
  );
  return { id, billId };
}

const scope = () => ({
  organizationId: ORG,
  outletIds: [outletId],
  notBefore: new Date(Date.now() - 3_600_000).toISOString(),
});

describe.skipIf(!RUN)('Billing ⇄ Stock results and reconciliation', () => {
  it('follows every bill end to end and records Stock results in Billing', async () => {
    const ok = await sale('SYNC-1', 1);
    const short = await sale('SYNC-2', 1); // 150 ml stock: second serving goes negative
    const broken = await sale('SYNC-3', 1, 99); // recipe version does not exist
    const waiting = await sale('SYNC-4', 1);
    await sale('OTHER-DAY', 1, 1, '2026-11-19');

    // Before anything is sent: all four are waiting in Billing.
    const before = await reconcileOutletDay(billing, stock, {
      organizationId: ORG,
      outletId,
      businessDate: DAY,
    });
    expect(before.sales).toBe(4);
    expect(before.counts.not_sent).toBe(4);
    expect(before.balanced).toBe(false);

    // Deliver and process the first three; SYNC-4 stays undelivered.
    await billing.query(
      "update outbox.events set next_attempt_at = now() + interval '1 hour' where id = $1",
      [waiting.id],
    );
    await deliverBillingEventsToStock(billing, stock, { scope: scope() });
    await processStockInbox(stock, { scope: scope(), maxAttempts: 1 });

    const mid = await reconcileOutletDay(billing, stock, {
      organizationId: ORG,
      outletId,
      businessDate: DAY,
    });
    expect(mid.counts).toMatchObject({ result_missing: 2, failed: 1, not_sent: 1 });

    const consumed = await consumeStockResults(billing, stock);
    expect(consumed.recorded).toBeGreaterThanOrEqual(3);
    const results = await billing.query<{ source_event_id: string; status: string }>(
      'select source_event_id, status from billing.stock_sync_results where source_event_id = any($1::uuid[])',
      [[ok.id, short.id, broken.id]],
    );
    expect(Object.fromEntries(results.rows.map((r) => [r.source_event_id, r.status]))).toEqual({
      [ok.id]: 'processed',
      [short.id]: 'negative_exception',
      [broken.id]: 'failed',
    });
    // Replaying the consumer records nothing new.
    expect((await consumeStockResults(billing, stock)).recorded).toBe(0);

    const after = await reconcileOutletDay(billing, stock, {
      organizationId: ORG,
      outletId,
      businessDate: DAY,
    });
    expect(after.counts).toMatchObject({ processed: 1, shortage: 1, failed: 1, not_sent: 1 });
    expect(after.problems.map((p) => p.receiptNumber).sort()).toEqual(['SYNC-3', 'SYNC-4']);
    expect(after.ledgerMismatches).toEqual([]);

    // Send the last bill: only the failed one remains a problem.
    await billing.query('update outbox.events set next_attempt_at = now() where id = $1', [
      waiting.id,
    ]);
    await deliverBillingEventsToStock(billing, stock, { scope: scope() });
    await processStockInbox(stock, { scope: scope() });
    await consumeStockResults(billing, stock);
    const last = await reconcileOutletDay(billing, stock, {
      organizationId: ORG,
      outletId,
      businessDate: DAY,
    });
    expect(last.problems.map((p) => p.category)).toEqual(['failed']);

    // A requirement line with no matching ledger movement is reported.
    const consumption = await stock.query<{ id: string; item_id: string }>(
      `select sc.id, l.item_id from stock.sale_consumptions sc
         join stock.sale_consumption_lines l on l.sale_consumption_id = sc.id
        where sc.source_event_id = $1 limit 1`,
      [ok.id],
    );
    const row = consumption.rows[0];
    expect(row).toBeDefined();
    await stock.query(
      `insert into stock.sale_consumption_lines (sale_consumption_id, recipe_id, recipe_version, item_id, qty_base)
       values ($1,$2,1,$3,5)`,
      [row?.id, recipeId, row?.item_id],
    );
    const tampered = await reconcileOutletDay(billing, stock, {
      organizationId: ORG,
      outletId,
      businessDate: DAY,
    });
    expect(tampered.ledgerMismatches).toHaveLength(1);
    expect(Number(tampered.ledgerMismatches[0]?.requiredBase)).toBe(105);
    expect(Number(tampered.ledgerMismatches[0]?.postedBase)).toBe(100);
  });

  it('rejects a malformed request', async () => {
    await expect(
      reconcileOutletDay(billing, stock, { organizationId: ORG, outletId, businessDate: 'x' }),
    ).rejects.toThrow(/outlet and a date/);
  });
});
