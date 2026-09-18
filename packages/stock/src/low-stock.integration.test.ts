import { saveOpeningStock } from './opening-stock';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPool,
  createStockPool,
  withStockActorContext,
  type Pool,
  type StockPool,
} from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { migrate } from '@jksh/db/migrate';
import { receiveLowStockNotification } from '@jksh/identity';
import type { LowStockEvent } from '@jksh/contracts';
import { stockSystemActor, type StockActor } from './authorize';
import { configureOutletStock, createItem, createBatch } from './inventory';
import { postMovements } from './ledger';
import {
  listLowStockItems,
  saveLowStockRule,
  scanLowStockRules,
  deliverLowStockEvents,
} from './low-stock';

const RUN = !!process.env.STOCK_DATABASE_URL && !!process.env.DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
let stock: StockPool;
let billing: Pool;
const sys = stockSystemActor(ORG);

beforeAll(async () => {
  if (!RUN) return;
  stock = createStockPool();
  billing = createPool();
  await stockMigrate(stock);
  await migrate(billing);
});
afterAll(async () => {
  if (RUN) await Promise.all([stock.end(), billing.end()]);
});

async function fixture(baseUnit = 'g', counted = true) {
  const outletId = randomUUID();
  const franchiseId = randomUUID();
  const brandId = randomUUID();
  const { sellableLocationId } = await configureOutletStock(stock, sys, {
    outletId,
    organizationId: ORG,
    franchiseId,
  });
  const item = await createItem(stock, sys, {
    organizationId: ORG,
    sku: randomUUID(),
    name: `Test ${baseUnit}`,
    itemType: 'raw_material',
    dimension: baseUnit === 'g' ? 'mass' : baseUnit === 'ml' ? 'volume' : 'count',
    baseUnit,
    supplyRule: 'flexible',
  });
  if (counted)
    await saveOpeningStock(stock, sys, outletId, { lines: [{ itemId: item.id, quantity: '0' }] });
  await billing.query(
    "insert into billing.brands(id,organization_id,slug,name) values ($1,$2,$3,'Alerts test')",
    [brandId, ORG, `alert-${brandId}`],
  );
  await billing.query(
    "insert into billing.franchises(id,organization_id,brand_id,name,slug) values ($1,$2,$3,'Alerts test',$4)",
    [franchiseId, ORG, brandId, `alert-${franchiseId}`],
  );
  await billing.query(
    "insert into billing.outlets(id,organization_id,brand_id,franchise_id,ownership_type,status,display_name,slug) values ($1,$2,$3,$4,'franchise_owned','active','Test outlet',$5)",
    [outletId, ORG, brandId, franchiseId, `alert-${outletId}`],
  );
  const owner: StockActor = {
    request: 'admin',
    role: 'franchise_owner',
    organizationId: ORG,
    franchiseId,
    warehouseIds: [],
  };
  const move = (quantity: string, batchId?: string) =>
    postMovements(stock, [
      {
        organizationId: ORG,
        stockLocationId: sellableLocationId,
        itemId: item.id,
        quantity,
        movementType: 'adjustment',
        sourceDocType: 'test',
        idempotencyKey: randomUUID(),
        ...(batchId ? { batchId } : {}),
      },
    ]);
  const save = (quantity: string, unit = baseUnit, enabled = true) =>
    saveLowStockRule(stock, owner, outletId, { itemId: item.id, quantity, unit, enabled });
  const row = async () =>
    (await listLowStockItems(stock, owner, outletId)).find((r) => r.itemId === item.id);
  return { outletId, franchiseId, itemId: item.id, owner, move, save, row };
}

async function events(outletId: string): Promise<LowStockEvent[]> {
  const { rows } = await stock.query<{ payload: LowStockEvent }>(
    "select payload from stock.low_stock_events where payload->>'outletId' = $1 order by id",
    [outletId],
  );
  return rows.map((r) => r.payload);
}

describe.skipIf(!RUN)('Low-stock limits and durable notification delivery', () => {
  it('does not alert for uncounted stock until the first delivery', async () => {
    const f = await fixture('g', false);
    await f.save('10');
    expect((await f.row())?.trackingStarted).toBe(false);
    expect((await f.row())?.low).toBe(false);
    expect(await events(f.outletId)).toHaveLength(0);
    await f.move('5');
    await scanLowStockRules(stock);
    expect((await f.row())?.trackingStarted).toBe(true);
    expect((await f.row())?.low).toBe(true);
  });
  it('starts unconfigured and opens exactly at the converted kg limit, without repeat alerts', async () => {
    const f = await fixture();
    await f.move('3001');
    expect((await f.row())?.threshold).toBeNull();
    await f.save('3', 'kg');
    expect((await f.row())?.threshold).toBe('3000.000000');
    expect(await events(f.outletId)).toHaveLength(0);
    await f.move('-1');
    await scanLowStockRules(stock);
    await scanLowStockRules(stock);
    expect((await f.row())?.low).toBe(true);
    expect(await events(f.outletId)).toHaveLength(1);
    await f.move('-10');
    await scanLowStockRules(stock);
    expect(await events(f.outletId)).toHaveLength(1);
  });
  it('supports litres, counts, zero limits and rejects dimension mismatches', async () => {
    const volume = await fixture('ml');
    await volume.save('2', 'l');
    expect((await volume.row())?.threshold).toBe('2000.000000');
    const count = await fixture('each');
    await count.save('2', 'dozen');
    expect((await count.row())?.threshold).toBe('24.000000');
    await expect(count.save('3', 'kg')).rejects.toMatchObject({ code: 'validation' });
    await count.save('0');
    expect((await count.row())?.low).toBe(true);
    await expect(count.save('-1')).rejects.toMatchObject({ code: 'validation' });
  });
  it('resolves after replenishment and opens a new episode on the next shortage', async () => {
    const f = await fixture();
    await f.save('10');
    await f.move('11');
    await scanLowStockRules(stock);
    await f.move('-1');
    await scanLowStockRules(stock);
    const all = await events(f.outletId);
    expect(all.map((e) => e.state)).toEqual(['low', 'resolved', 'low']);
    expect(all[0]?.episodeId).toBe(all[1]?.episodeId);
    expect(all[2]?.episodeId).not.toBe(all[0]?.episodeId);
    await f.save('10', 'g', false);
    expect((await events(f.outletId)).at(-1)?.state).toBe('resolved');
  });
  it('ignores expired and quarantined stock and detects expiry without a movement', async () => {
    const f = await fixture();
    const expired = await createBatch(stock, sys, {
      organizationId: ORG,
      itemId: f.itemId,
      batchCode: randomUUID(),
      expiryDate: '2020-01-01',
      origin: 'received',
    });
    await f.move('5000', expired.id);
    const active = await createBatch(stock, sys, {
      organizationId: ORG,
      itemId: f.itemId,
      batchCode: randomUUID(),
      expiryDate: '2099-01-01',
      origin: 'received',
    });
    await f.move('20', active.id);
    await f.save('10');
    expect((await f.row())?.quantity).toBe('20.000000');
    await stock.query("update stock.batches set status = 'quarantined' where id = $1", [active.id]);
    await scanLowStockRules(stock);
    expect((await f.row())?.low).toBe(true);
  });
  it('rejects cross-franchise and cross-organization configuration and protects rules with RLS', async () => {
    const f = await fixture();
    await f.save('10');
    const outsider = { ...f.owner, franchiseId: randomUUID() };
    await expect(listLowStockItems(stock, outsider, f.outletId)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      saveLowStockRule(stock, outsider, f.outletId, {
        itemId: f.itemId,
        quantity: '9',
        unit: 'g',
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const otherOrg = { ...f.owner, role: 'central_admin' as const, organizationId: randomUUID() };
    await expect(
      saveLowStockRule(stock, otherOrg, f.outletId, {
        itemId: f.itemId,
        quantity: '9',
        unit: 'g',
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const direct = await withStockActorContext(
      stock,
      {
        request: 'admin',
        role: 'franchise_owner',
        organizationId: ORG,
        franchiseId: outsider.franchiseId,
      },
      (c) => c.query('select id from stock.low_stock_rules where outlet_id = $1', [f.outletId]),
    );
    expect(direct.rowCount).toBe(0);
  });
  it('serializes concurrent scans and retries notification delivery without duplicates or reopened notices', async () => {
    const f = await fixture();
    await f.save('10');
    await Promise.all([scanLowStockRules(stock), scanLowStockRules(stock)]);
    expect(await events(f.outletId)).toHaveLength(1);
    let fail = true;
    const receiver = async (event: LowStockEvent) => {
      await receiveLowStockNotification(billing, event);
      if (event.outletId === f.outletId && fail) {
        fail = false;
        throw new Error('Lost acknowledgement');
      }
    };
    expect((await deliverLowStockEvents(stock, receiver, 500)).failed).toBe(1);
    await deliverLowStockEvents(stock, receiver, 500);
    let notices = await billing.query<{ recipient_role: string; resolved_at: Date | null }>(
      'select * from identity.notifications where outlet_id = $1',
      [f.outletId],
    );
    expect(notices.rowCount).toBe(2);
    expect(notices.rows.map((r) => r.recipient_role).sort()).toEqual([
      'central_admin',
      'franchise_owner',
    ]);
    await f.move('20');
    await scanLowStockRules(stock);
    await deliverLowStockEvents(stock, receiver, 500);
    const first = (await events(f.outletId))[0];
    if (!first) throw new Error('Missing low event');
    await receiveLowStockNotification(billing, first);
    notices = await billing.query<{ recipient_role: string; resolved_at: Date | null }>(
      'select * from identity.notifications where outlet_id = $1',
      [f.outletId],
    );
    expect(notices.rowCount).toBe(2);
    expect(notices.rows.every((r) => r.resolved_at !== null)).toBe(true);
  });
});
