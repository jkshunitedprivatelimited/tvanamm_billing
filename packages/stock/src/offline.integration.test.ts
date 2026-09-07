/**
 * Stock S7 offline + hardening against a real Postgres: the durable offline
 * draft queue, feature flags, the Billing->Stock relay, inbox processing with
 * dead-lettering, and cross-system reconciliation. Runs only when
 * STOCK_DATABASE_URL and DATABASE_URL are both set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, createStockPool, type Pool, type StockPool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, configureOutletStock, getItemBalances } from './inventory';
import {
  enqueueOfflineDraft,
  syncOfflineDrafts,
  isStockFeatureEnabled,
  setStockFeatureFlag,
} from './offline';
import { deliverBillingEventsToStock, processStockInbox, reconcileCrossSystem } from './relay';

const RUN = !!process.env.STOCK_DATABASE_URL && !!process.env.DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = '88888888-8888-4888-8888-888888888888';
const OUTLET = '99999999-9999-4999-8999-999999999991';
const S = Date.now().toString(36);

let stockPool: StockPool;
let billingPool: Pool;
let sys: StockActor;
let milkId: string;
let outletLoc: string;

beforeAll(async () => {
  if (!RUN) return;
  stockPool = createStockPool();
  billingPool = createPool(process.env.DATABASE_URL);
  await stockMigrate(stockPool);
  await migrate(billingPool);
  sys = stockSystemActor(ORG);

  // These local DBs are disposable integration fixtures; clear the cross-system
  // pipeline so the relay assertions start from a known state (other Stock test
  // files leave ingested-but-unprocessed inbox rows behind).
  await billingPool.query(
    `delete from outbox.events where event_type in ('SaleCompleted', 'SaleRefunded')`,
  );
  await stockPool.query('delete from stock_inbox.events');

  milkId = (
    await createItem(stockPool, sys, {
      organizationId: ORG,
      sku: `OMILK-${S}`,
      name: 'Milk',
      itemType: 'raw_material',
      dimension: 'volume',
      baseUnit: 'ml',
      supplyRule: 'local_purchase',
    })
  ).id;
  outletLoc = (
    await configureOutletStock(stockPool, sys, {
      outletId: OUTLET,
      organizationId: ORG,
      franchiseId: FRANCHISE,
    })
  ).sellableLocationId;
});

afterAll(async () => {
  if (!RUN) return;
  await stockPool.end();
  await billingPool.end();
});

async function outletOnHand(): Promise<number> {
  return (await getItemBalances(stockPool, sys, milkId))
    .filter((r) => r.stockLocationId === outletLoc)
    .reduce((s, r) => s + Number(r.onHand), 0);
}

describe.skipIf(!RUN)('Stock offline drafts', () => {
  it('queues drafts idempotently and applies them in sequence', async () => {
    const device = `dev-${S}`;
    const before = await outletOnHand();

    const first = await enqueueOfflineDraft(stockPool, sys, {
      deviceId: device,
      organizationId: ORG,
      outletId: OUTLET,
      kind: 'local_inward',
      sequence: 1,
      idempotencyKey: `d1-${S}`,
      payload: {
        organizationId: ORG,
        outletId: OUTLET,
        franchiseId: FRANCHISE,
        itemId: milkId,
        qtyBase: '300',
      },
    });
    expect(first.duplicate).toBe(false);
    const dup = await enqueueOfflineDraft(stockPool, sys, {
      deviceId: device,
      organizationId: ORG,
      outletId: OUTLET,
      kind: 'local_inward',
      sequence: 1,
      idempotencyKey: `d1-${S}`,
      payload: {},
    });
    expect(dup.duplicate).toBe(true);

    // A draft that will fail (missing required fields).
    await enqueueOfflineDraft(stockPool, sys, {
      deviceId: device,
      organizationId: ORG,
      outletId: OUTLET,
      kind: 'wastage',
      sequence: 2,
      idempotencyKey: `d2-${S}`,
      payload: { organizationId: ORG, itemId: milkId },
    });

    const result = await syncOfflineDrafts(stockPool, sys, device);
    expect(result.applied).toBe(1);
    expect(result.rejected).toBe(1);
    expect(await outletOnHand()).toBeCloseTo(before + 300, 4);

    const statuses = await stockPool.query<{ status: string }>(
      'select status from stock.offline_drafts where device_id = $1 order by sequence',
      [device],
    );
    expect(statuses.rows.map((r) => r.status)).toEqual(['applied', 'rejected']);
  });
});

describe.skipIf(!RUN)('Stock feature flags', () => {
  it('gates the system behind stock.enabled', async () => {
    expect(await isStockFeatureEnabled(stockPool, 'stock.enabled')).toBe(false);
    await setStockFeatureFlag(stockPool, sys, 'stock.enabled', true);
    expect(await isStockFeatureEnabled(stockPool, 'stock.enabled')).toBe(true);
    await setStockFeatureFlag(stockPool, sys, 'stock.enabled', false);
  });
});

describe.skipIf(!RUN)('Billing -> Stock relay', () => {
  it('delivers outbox events into the inbox exactly once and processes them', async () => {
    const billId = randomUUID();
    await billingPool.query(
      `insert into outbox.events
         (event_type, aggregate_id, organization_id, franchise_id, outlet_id, correlation_id,
          idempotency_key, payload)
       values ('SaleCompleted',$1,$2,$3,$4,$5,$6,$7)`,
      [
        billId,
        ORG,
        FRANCHISE,
        OUTLET,
        randomUUID(),
        `SaleCompleted:${billId}`,
        JSON.stringify({
          billId,
          outletId: OUTLET,
          receiptNumber: `OR-${S}`,
          businessDate: '2026-09-07',
          finalTotal: '30.00',
          lines: [
            {
              billLineId: randomUUID(),
              catalogItemId: randomUUID(),
              quantity: 1,
              stockRecipeId: null,
              stockRecipeVersion: null,
              addons: [],
            },
          ],
        }),
      ],
    );

    const delivery = await deliverBillingEventsToStock(billingPool, stockPool, { limit: 50 });
    expect(delivery.delivered).toBeGreaterThanOrEqual(1);

    // Re-running finds nothing pending (Billing rows are marked delivered).
    const again = await deliverBillingEventsToStock(billingPool, stockPool, { limit: 50 });
    expect(again.delivered).toBe(0);

    const inbox = await processStockInbox(stockPool, { limit: 50 });
    expect(inbox.processed).toBeGreaterThanOrEqual(1);
    expect(inbox.deadLettered).toBe(0);

    const report = await reconcileCrossSystem(stockPool, ORG);
    expect(report.unprocessedInbox).toBe(0);
    expect(report.deadLetteredInbox).toBe(0);
  });
});
