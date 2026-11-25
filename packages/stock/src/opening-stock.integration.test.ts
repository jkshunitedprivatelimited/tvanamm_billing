import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { configureOutletStock, createItem, getItemBalances } from './inventory';
import { saveOpeningStock } from './opening-stock';

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

async function fixture() {
  const outletId = randomUUID(),
    franchiseId = randomUUID();
  const location = await configureOutletStock(pool, sys, {
    outletId,
    franchiseId,
    organizationId: ORG,
  });
  const item = await createItem(pool, sys, {
    organizationId: ORG,
    sku: randomUUID(),
    name: 'Opening test milk',
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
  return { outletId, locationId: location.sellableLocationId, itemId: item.id, owner };
}

describe.skipIf(!RUN)('Opening stock acknowledgements', () => {
  it('acknowledges concurrent retries once and preserves immutable counted stock', async () => {
    const f = await fixture();
    const submissionId = randomUUID();
    const input = { submissionId, lines: [{ itemId: f.itemId, quantity: '1250.5' }] };
    const results = await Promise.all([
      saveOpeningStock(pool, f.owner, f.outletId, input),
      saveOpeningStock(pool, f.owner, f.outletId, input),
    ]);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(results.every((r) => r.submissionId === submissionId && r.saved === 1)).toBe(true);
    const balance = await getItemBalances(pool, sys, f.itemId);
    expect(balance.find((b) => b.stockLocationId === f.locationId)?.onHand).toBe('1250.500000');
    await expect(
      saveOpeningStock(pool, f.owner, f.outletId, {
        submissionId,
        lines: [{ itemId: f.itemId, quantity: '2000' }],
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      saveOpeningStock(pool, f.owner, f.outletId, {
        submissionId: randomUUID(),
        lines: input.lines,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('records zero as counted and does not let another outlet reuse the acknowledgement', async () => {
    const f = await fixture(),
      other = await fixture();
    const input = { submissionId: randomUUID(), lines: [{ itemId: f.itemId, quantity: '0' }] };
    await saveOpeningStock(pool, f.owner, f.outletId, input);
    expect(await saveOpeningStock(pool, f.owner, f.outletId, input)).toMatchObject({
      replayed: true,
    });
    const started = await pool.query(
      'select 1 from stock.item_tracking_starts where stock_location_id=$1 and item_id=$2',
      [f.locationId, f.itemId],
    );
    expect(started.rowCount).toBe(1);
    await expect(saveOpeningStock(pool, other.owner, other.outletId, input)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(saveOpeningStock(pool, other.owner, f.outletId, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      saveOpeningStock(pool, { ...f.owner, organizationId: randomUUID() }, f.outletId, input),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      saveOpeningStock(
        pool,
        { ...f.owner, role: 'store_employee', request: 'operator', outletId: f.outletId },
        f.outletId,
        input,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rolls back every line and acknowledgement when any item is invalid', async () => {
    const f = await fixture();
    const submissionId = randomUUID();
    await expect(
      saveOpeningStock(pool, f.owner, f.outletId, {
        submissionId,
        lines: [
          { itemId: f.itemId, quantity: '10' },
          { itemId: randomUUID(), quantity: '1' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    const saved = await pool.query('select 1 from stock.opening_stock_submissions where id=$1', [
      submissionId,
    ]);
    expect(saved.rowCount).toBe(0);
    expect(
      await saveOpeningStock(pool, f.owner, f.outletId, {
        submissionId,
        lines: [{ itemId: f.itemId, quantity: '10' }],
      }),
    ).toMatchObject({ replayed: false, saved: 1 });
  });
});
