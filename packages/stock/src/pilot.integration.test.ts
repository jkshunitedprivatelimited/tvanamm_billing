import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createPool, createStockPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor } from './authorize';
import { createItem, configureOutletStock, getItemBalances } from './inventory';
import { saveOpeningStock } from './opening-stock';
import { createRecipe, publishRecipeVersion } from './recipes';
import { runStockEventCycle } from './event-cycle';
import { setStockFeatureFlag } from './offline';

const RUN = !!process.env.DATABASE_URL && !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const sys = stockSystemActor(ORG);
let billing: Pool;
let stock: Pool;
beforeAll(async () => {
  if (!RUN) return;
  billing = createPool();
  stock = createStockPool();
  await migrate(billing);
  await stockMigrate(stock);
});
afterAll(async () => {
  if (RUN) {
    await setStockFeatureFlag(stock, sys, 'stock.events.enabled', false);
    await setStockFeatureFlag(stock, sys, 'stock.enabled', false);
    await Promise.all([billing.end(), stock.end()]);
  }
});

describe.skipIf(!RUN)('Named test outlet stock trial', () => {
  it('isolates two shops and consumes a sale exactly once across relay retries', async () => {
    const brand = randomUUID(),
      franchise = randomUUID();
    await billing.query(
      "insert into billing.brands(id,organization_id,slug,name) values($1,$2,$3,'TEST Stock Brand')",
      [brand, ORG, `test-stock-${brand}`],
    );
    await billing.query(
      "insert into billing.franchises(id,organization_id,brand_id,name,slug) values($1,$2,$3,'TEST Stock Franchise',$4)",
      [franchise, ORG, brand, `test-stock-${franchise}`],
    );
    const outlets: { id: string; locationId: string }[] = [];
    const milk = await createItem(stock, sys, {
      organizationId: ORG,
      sku: `PILOT-MILK-${randomUUID()}`,
      name: 'TEST Milk',
      itemType: 'raw_material',
      dimension: 'volume',
      baseUnit: 'ml',
      supplyRule: 'local_purchase',
    });
    for (const n of [1, 2]) {
      const id = randomUUID();
      await billing.query(
        `insert into billing.outlets(id,organization_id,brand_id,franchise_id,ownership_type,status,display_name,slug,billing_enabled)
         values($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
        [id, ORG, brand, franchise, `TEST Stock Outlet ${String(n)}`, `test-stock-${id}`],
      );
      const configured = await configureOutletStock(stock, sys, {
        outletId: id,
        organizationId: ORG,
        franchiseId: franchise,
      });
      await saveOpeningStock(stock, sys, id, { lines: [{ itemId: milk.id, quantity: '1000' }] });
      outlets.push({ id, locationId: configured.sellableLocationId });
    }
    const recipe = await createRecipe(stock, sys, {
      organizationId: ORG,
      kind: 'menu_item',
      name: 'TEST Milk serving',
    });
    await publishRecipeVersion(stock, sys, recipe.id, {
      servingQtyBase: '100',
      servingUnit: 'ml',
      components: [{ componentType: 'fixed', itemId: milk.id, qtyBase: '100' }],
    });
    const eventId = randomUUID(),
      billId = randomUUID();
    const first = outlets[0]!,
      second = outlets[1]!;
    await billing.query(
      `insert into outbox.events(id,event_type,aggregate_id,organization_id,franchise_id,outlet_id,correlation_id,idempotency_key,payload)
       values($1::uuid,'SaleCompleted',$2,$3,$4,$5,$6,$1::text,$7)`,
      [
        eventId,
        billId,
        ORG,
        franchise,
        first.id,
        randomUUID(),
        JSON.stringify({
          billId,
          outletId: first.id,
          receiptNumber: 'TEST-STOCK-1',
          businessDate: '2026-10-10',
          finalTotal: '20.00',
          lines: [
            {
              billLineId: randomUUID(),
              catalogItemId: randomUUID(),
              quantity: 2,
              stockRecipeId: recipe.id,
              stockRecipeVersion: 1,
              addons: [],
            },
          ],
        }),
      ],
    );
    const historicalId = randomUUID(),
      otherId = randomUUID();
    for (const [id, outletId, historical] of [
      [historicalId, first.id, true],
      [otherId, second.id, false],
    ] as const) {
      await billing.query(
        `insert into outbox.events(id,event_type,aggregate_id,organization_id,franchise_id,outlet_id,correlation_id,idempotency_key,payload,created_at)
         select $1::uuid,'SaleCompleted',aggregate_id,organization_id,franchise_id,$2::uuid,correlation_id,$1::text,
           jsonb_set(payload,'{outletId}',to_jsonb($2::text)),case when $3 then now()-interval '2 days' else now() end
         from outbox.events where id=$4`,
        [id, outletId, historical, eventId],
      );
    }
    await setStockFeatureFlag(stock, sys, 'stock.enabled', true);
    await setStockFeatureFlag(stock, sys, 'stock.events.enabled', false);
    expect(await runStockEventCycle(billing, stock)).toMatchObject({ paused: true });
    await setStockFeatureFlag(stock, sys, 'stock.events.enabled', true, {
      organizationId: ORG,
      outletIds: [first.id],
    });
    expect(await runStockEventCycle(billing, stock)).toMatchObject({ reason: 'invalid_scope' });
    await setStockFeatureFlag(stock, sys, 'stock.events.enabled', true, {
      organizationId: ORG,
      outletIds: [first.id],
      notBefore: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await runStockEventCycle(billing, stock, randomUUID())).toMatchObject({
      reason: 'invalid_scope',
    });
    expect(await runStockEventCycle(billing, stock, ORG)).toMatchObject({
      delivery: { delivered: 1 },
      inbox: { processed: 1 },
    });
    const excluded = await billing.query<{ status: string; attempts: number }>(
      'select status,attempts from outbox.events where id=any($1::uuid[])',
      [[historicalId, otherId]],
    );
    expect(excluded.rows).toEqual([
      { status: 'pending', attempts: 0 },
      { status: 'pending', attempts: 0 },
    ]);
    const quantity = async (locationId: string) =>
      (await getItemBalances(stock, sys, milk.id))
        .filter((b) => b.stockLocationId === locationId)
        .reduce((sum, b) => sum + Number(b.onHand), 0);
    expect(await quantity(first.locationId)).toBe(800);
    expect(await quantity(second.locationId)).toBe(1000);
    // Emulate a relay acknowledgement lost after the Stock transaction committed.
    await billing.query(
      "update outbox.events set status='pending', next_attempt_at=now() where id=$1",
      [eventId],
    );
    expect((await runStockEventCycle(billing, stock)).delivery.skipped).toBe(1);
    expect(await quantity(first.locationId)).toBe(800);
    expect(await quantity(second.locationId)).toBe(1000);
  });
});
