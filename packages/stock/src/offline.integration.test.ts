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

  it('preserves pilot scope when paused and resumed without config', async () => {
    const key = `stock.pilot-scope-${S}`;
    const scope = { organizationId: ORG, outletIds: [OUTLET] };
    const readFlag = async () =>
      (
        await stockPool.query<{ enabled: boolean; config: Record<string, unknown> }>(
          'select enabled, config from stock.feature_flags where key = $1',
          [key],
        )
      ).rows[0];

    await setStockFeatureFlag(stockPool, sys, key, true, scope);
    await setStockFeatureFlag(stockPool, sys, key, false);
    expect(await readFlag()).toEqual({ enabled: false, config: scope });
    await setStockFeatureFlag(stockPool, sys, key, true);
    expect(await readFlag()).toEqual({ enabled: true, config: scope });

    const replacement = { organizationId: ORG, outletIds: [randomUUID()], rollout: 'expanded' };
    await setStockFeatureFlag(stockPool, sys, key, true, replacement);
    expect(await readFlag()).toEqual({ enabled: true, config: replacement });
    await setStockFeatureFlag(stockPool, sys, key, false, {});
    expect(await readFlag()).toEqual({ enabled: false, config: {} });
  });

  it('defaults a new flag to empty config when config is omitted', async () => {
    const key = `stock.new-flag-${S}`;
    await setStockFeatureFlag(stockPool, sys, key, true);
    const { rows } = await stockPool.query<{ enabled: boolean; config: Record<string, unknown> }>(
      'select enabled, config from stock.feature_flags where key = $1',
      [key],
    );
    expect(rows[0]).toEqual({ enabled: true, config: {} });
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
  it('delays poison-event retries, dead-letters at the cap and allows explicit recovery', async () => {
    const { withStockActorContext, stockSystemContext } = await import('@jksh/db');
    const { ingestInboundEvent } = await import('./events');
    const { retryInboxDeadLetter } = await import('./integration-health');
    const eventId = randomUUID();
    const landed = await withStockActorContext(stockPool, stockSystemContext(), (c) =>
      ingestInboundEvent(c, {
        eventId,
        eventType: 'SaleCompleted',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        source: 'billing',
        correlationId: randomUUID(),
        organizationId: ORG,
        franchiseId: FRANCHISE,
        outletId: OUTLET,
        payload: {},
      }),
    );
    expect((await processStockInbox(stockPool, { maxAttempts: 2 })).failed).toBe(1);
    expect((await processStockInbox(stockPool, { maxAttempts: 2 })).failed).toBe(0);
    await stockPool.query('update stock_inbox.events set next_attempt_at = now() where id = $1', [
      landed.inboxId,
    ]);
    expect((await processStockInbox(stockPool, { maxAttempts: 2 })).deadLettered).toBe(1);
    expect(await retryInboxDeadLetter(stockPool, landed.inboxId)).toBe(true);
    expect((await processStockInbox(stockPool, { maxAttempts: 2 })).failed).toBe(1);
  });

  it('continues delivery past an unsupported version without duplicate concurrent effects', async () => {
    const bad = randomUUID();
    const good = randomUUID();
    for (const [id, version] of [
      [bad, 2],
      [good, 1],
    ] as const) {
      await billingPool.query(
        `insert into outbox.events(id,event_type,event_version,aggregate_id,organization_id,
          franchise_id,outlet_id,correlation_id,idempotency_key,payload)
         values ($2,'SaleCompleted',$1,$2,$3,$4,$5,$6,$7,$8)`,
        [version, id, ORG, FRANCHISE, OUTLET, randomUUID(), id, JSON.stringify({})],
      );
    }
    const deliveries = await Promise.all([
      deliverBillingEventsToStock(billingPool, stockPool),
      deliverBillingEventsToStock(billingPool, stockPool),
    ]);
    expect(deliveries.reduce((n, r) => n + r.failed, 0)).toBe(1);
    expect(deliveries.reduce((n, r) => n + r.delivered, 0)).toBe(1);
    expect(
      (
        await billingPool.query('select status,attempts from outbox.events where aggregate_id=$1', [
          bad,
        ])
      ).rows[0],
    ).toMatchObject({ status: 'pending', attempts: 1 });
    expect(
      (
        await stockPool.query(
          'select count(*)::int n from stock_inbox.events where source_event_id=$1',
          [good],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('only requeues failed Billing transfers in the selected organization', async () => {
    const { retryBillingDeadLetter } = await import('./integration-health');
    const id = randomUUID();
    await billingPool.query(
      `insert into outbox.events(id,event_type,aggregate_id,organization_id,outlet_id,correlation_id,idempotency_key,payload,status)
       values($1::uuid,'SaleCompleted',$1::uuid,$2,$3,$4,$1::text,'{}','dead_letter')`,
      [id, ORG, OUTLET, randomUUID()],
    );
    expect(await retryBillingDeadLetter(billingPool, id, randomUUID())).toBe(false);
    expect(await retryBillingDeadLetter(billingPool, id, ORG)).toBe(true);
    expect(await retryBillingDeadLetter(billingPool, id, ORG)).toBe(false);
  });
});
