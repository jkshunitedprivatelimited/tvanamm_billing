// Stock side of the permanent outlet purge (stock migration 0025).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockPool, withStockActorContext, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { configureOutletStock, createItem } from './inventory';
import { saveOpeningStock } from './opening-stock';
import { purgeOutletStock } from './outlet-purge';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const sys = stockSystemActor(ORG);
let pool: StockPool;

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
});
afterAll(async () => {
  if (RUN) await pool.end();
});

async function stockedOutlet() {
  const outletId = randomUUID();
  const franchiseId = randomUUID();
  await configureOutletStock(pool, sys, { outletId, franchiseId, organizationId: ORG });
  const item = await createItem(pool, sys, {
    organizationId: ORG,
    sku: randomUUID(),
    name: 'Purge test milk',
    itemType: 'raw_material',
    dimension: 'volume',
    baseUnit: 'ml',
    supplyRule: 'local_purchase',
  });
  const owner: StockActor = {
    request: 'admin',
    role: 'franchise_owner',
    organizationId: ORG,
    franchiseId,
    warehouseIds: [],
  };
  // Opening stock writes append-only movements.
  await saveOpeningStock(pool, owner, outletId, {
    submissionId: randomUUID(),
    lines: [{ itemId: item.id, quantity: '500' }],
  });
  return { outletId, franchiseId };
}

async function rowsFor(outletId: string): Promise<{ locations: number; movements: number }> {
  const { rows } = await pool.query<{ locations: number; movements: number }>(
    `select (select count(*)::int from stock.stock_locations where outlet_id = $1) locations,
            (select count(*)::int from stock.stock_movements where outlet_id = $1) movements`,
    [outletId],
  );
  return rows[0]!;
}

describe.skipIf(!RUN)('Stock outlet purge', () => {
  it('removes one outlet, keeps another, and is safe to rerun', async () => {
    const gone = await stockedOutlet();
    const kept = await stockedOutlet();
    const keptBefore = await rowsFor(kept.outletId);
    expect((await rowsFor(gone.outletId)).movements).toBeGreaterThan(0);

    const input = {
      organizationId: ORG,
      outletId: gone.outletId,
      franchiseId: gone.franchiseId,
      accountIds: [],
    };
    await purgeOutletStock(pool, input);
    expect(await rowsFor(gone.outletId)).toEqual({ locations: 0, movements: 0 });
    expect(await rowsFor(kept.outletId)).toEqual(keptBefore);
    await purgeOutletStock(pool, input); // idempotent

    // Movements stay append-only outside the purge.
    await expect(
      pool.query('delete from stock.stock_movements where outlet_id = $1', [kept.outletId]),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses a non-Central caller and the API role deleting directly', async () => {
    const o = await stockedOutlet();
    await expect(
      withStockActorContext(
        pool,
        { request: 'admin', role: 'franchise_owner', organizationId: ORG },
        (c) => c.query('select stock.purge_outlet($1, null, null)', [o.outletId]),
      ),
    ).rejects.toThrow(/only Central Admin/);
    await expect(
      withStockActorContext(
        pool,
        { request: 'admin', role: 'central_admin', organizationId: ORG },
        async (c) => {
          await c.query(`select set_config('jksh.purge','on',true)`);
          await c.query('delete from stock.stock_movements where outlet_id = $1', [o.outletId]);
        },
      ),
    ).rejects.toThrow(/permission denied|append-only/);
    expect((await rowsFor(o.outletId)).movements).toBeGreaterThan(0);
  });
});
