import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createStockPool, withStockActorContext, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, stockContextForActor, type StockActor } from './authorize';
import { configureOutletStock, createItem, getItemBalances } from './inventory';
import { saveOpeningStock } from './opening-stock';
import { listOwnerPilotOutlets } from './owner-rollout';
import { setStockFeatureFlag } from './offline';
import { listLowStockItems } from './low-stock';
import { getStockOrder } from './stock-orders';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const sys = stockSystemActor(ORG);
let pool: StockPool;
beforeAll(async () => {
  if (RUN) {
    pool = createStockPool();
    await stockMigrate(pool);
  }
});
afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Owner pilot rollout', () => {
  it('fails closed and constrains same-franchise outlet reads and writes, including direct SQL', async () => {
    const franchiseId = randomUUID();
    const pilot = randomUUID(),
      sibling = randomUUID(),
      foreign = randomUUID();
    for (const outletId of [pilot, sibling, foreign])
      await configureOutletStock(pool, sys, {
        organizationId: ORG,
        outletId,
        franchiseId: outletId === foreign ? randomUUID() : franchiseId,
      });
    const item = await createItem(pool, sys, {
      organizationId: ORG,
      sku: randomUUID(),
      name: 'Pilot material',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
      supplyRule: 'flexible',
    });
    for (const outletId of [pilot, sibling])
      await saveOpeningStock(pool, sys, outletId, { lines: [{ itemId: item.id, quantity: '10' }] });
    const owner: StockActor = {
      request: 'admin',
      role: 'franchise_owner',
      organizationId: ORG,
      franchiseId,
      warehouseIds: [],
    };
    try {
      await setStockFeatureFlag(pool, sys, 'stock.enabled', true);
      await setStockFeatureFlag(pool, sys, 'stock.owner_portal.enabled', false);
      expect(await listOwnerPilotOutlets(pool, ORG, franchiseId)).toEqual([]);
      for (const config of [
        {},
        { organizationId: ORG, outletIds: ['*'] },
        { organizationId: randomUUID(), outletIds: [pilot] },
      ]) {
        await setStockFeatureFlag(pool, sys, 'stock.owner_portal.enabled', true, config);
        expect(await listOwnerPilotOutlets(pool, ORG, franchiseId)).toEqual([]);
      }
      await setStockFeatureFlag(pool, sys, 'stock.owner_portal.enabled', true, {
        organizationId: ORG,
        outletIds: [pilot, foreign],
      });
      const allowedOutletIds = await listOwnerPilotOutlets(pool, ORG, franchiseId);
      expect(allowedOutletIds).toEqual([pilot]);
      const scoped = { ...owner, allowedOutletIds };
      const orderIds = [randomUUID(), randomUUID()];
      for (const [index, outletId] of [pilot, sibling].entries())
        await pool.query(
          'insert into stock.stock_orders(id,organization_id,outlet_id,franchise_id,order_number) values($1,$2,$3,$4,$5)',
          [orderIds[index], ORG, outletId, franchiseId, randomUUID()],
        );
      const pilotOrder = orderIds[0],
        siblingOrder = orderIds[1];
      if (!pilotOrder || !siblingOrder) throw new Error('Missing order fixture');
      expect((await getStockOrder(pool, scoped, pilotOrder)).outletId).toBe(pilot);
      await expect(getStockOrder(pool, scoped, siblingOrder)).rejects.toMatchObject({
        code: 'not_found',
      });
      expect((await listLowStockItems(pool, scoped, pilot)).some((r) => r.itemId === item.id)).toBe(
        true,
      );
      await expect(listLowStockItems(pool, scoped, sibling)).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(
        saveOpeningStock(pool, scoped, sibling, { lines: [{ itemId: item.id, quantity: '1' }] }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      const rows = await withStockActorContext(pool, stockContextForActor(scoped), (c) =>
        c.query<{ outlet_id: string }>(
          'select outlet_id from stock.stock_balances where item_id=$1',
          [item.id],
        ),
      );
      expect(rows.rows.map((r) => r.outlet_id)).toEqual([pilot]);
      const denied = await withStockActorContext(pool, stockContextForActor(scoped), (c) =>
        c.query(
          'update stock.outlet_stock_settings set tracking_enabled=false where outlet_id=$1',
          [sibling],
        ),
      );
      expect(denied.rowCount).toBe(0);
      expect(await getItemBalances(pool, { ...owner, allowedOutletIds: [] }, item.id)).toEqual([]);
      // Internal contexts remain unrestricted after a restricted connection is reused.
      expect(await getItemBalances(pool, sys, item.id)).toHaveLength(2);
      await setStockFeatureFlag(pool, sys, 'stock.enabled', false);
      expect(await listOwnerPilotOutlets(pool, ORG, franchiseId)).toEqual([]);
    } finally {
      await setStockFeatureFlag(pool, sys, 'stock.owner_portal.enabled', false);
      await setStockFeatureFlag(pool, sys, 'stock.enabled', false);
    }
  });
});
