/**
 * Stock S2 inventory core against a real Postgres: the movement ledger, its
 * balance and valuation projections, idempotency, FEFO picking, projection
 * rebuild, and concurrent posting. Runs only when STOCK_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStockPool,
  withStockActorContext,
  stockSystemContext,
  type StockPool,
} from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, createWarehouse, createBatch, getItemBalances } from './inventory';
import { postMovement, postMovements, pickFefo, rebuildProjections } from './ledger';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let teaItemId: string;
let sellableLocId: string;

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);

  const item = await createItem(pool, sys, {
    organizationId: ORG,
    sku: `TEA-${S}`,
    name: 'Tea Powder',
    itemType: 'raw_material',
    dimension: 'mass',
    baseUnit: 'g',
    supplyRule: 'jksh_required',
    isBatchTracked: true,
  });
  teaItemId = item.id;

  const wh = await createWarehouse(pool, sys, {
    organizationId: ORG,
    code: `WH-${S}`,
    name: `Central ${S}`,
  });
  sellableLocId = wh.locationIds.sellable!;
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Stock inventory core', () => {
  it('posts a receipt and projects balance + weighted-average valuation', async () => {
    const batch = await createBatch(pool, sys, {
      organizationId: ORG,
      itemId: teaItemId,
      batchCode: `B1-${S}`,
      expiryDate: '2027-01-01',
      origin: 'received',
    });

    await postMovements(pool, [
      {
        organizationId: ORG,
        stockLocationId: sellableLocId,
        itemId: teaItemId,
        batchId: batch.id,
        quantity: '1000.000000',
        movementType: 'receipt',
        unitCostPaise: 40,
        sourceDocType: 'test.receipt',
        idempotencyKey: `rcpt-1-${S}`,
      },
    ]);

    const { rows } = await pool.query<{ on_hand: string; avg: string; qty: string }>(
      `select b.on_hand,
              v.avg_cost_paise as avg, v.on_hand_qty as qty
         from stock.stock_balances b
         join stock.item_valuation v on v.item_id = b.item_id and v.organization_id = b.organization_id
        where b.item_id = $1 and b.stock_location_id = $2`,
      [teaItemId, sellableLocId],
    );
    expect(Number(rows[0]!.on_hand)).toBe(1000);
    expect(Number(rows[0]!.avg)).toBeCloseTo(40, 4);
    expect(Number(rows[0]!.qty)).toBe(1000);
  });

  it('blends a second receipt into the moving average', async () => {
    const batch = await createBatch(pool, sys, {
      organizationId: ORG,
      itemId: teaItemId,
      batchCode: `B2-${S}`,
      expiryDate: '2027-03-01',
      origin: 'received',
    });
    await postMovements(pool, [
      {
        organizationId: ORG,
        stockLocationId: sellableLocId,
        itemId: teaItemId,
        batchId: batch.id,
        quantity: '3000.000000',
        movementType: 'receipt',
        unitCostPaise: 60,
        sourceDocType: 'test.receipt',
        idempotencyKey: `rcpt-2-${S}`,
      },
    ]);
    const { rows } = await pool.query<{ avg: string; qty: string }>(
      `select avg_cost_paise as avg, on_hand_qty as qty from stock.item_valuation
        where item_id = $1 and organization_id = $2`,
      [teaItemId, ORG],
    );
    // (1000*40 + 3000*60) / 4000 = 55
    expect(Number(rows[0]!.avg)).toBeCloseTo(55, 4);
    expect(Number(rows[0]!.qty)).toBe(4000);
  });

  it('is idempotent on (organization_id, idempotency_key)', async () => {
    const key = `dup-${S}`;
    const entry = {
      organizationId: ORG,
      stockLocationId: sellableLocId,
      itemId: teaItemId,
      quantity: '10.000000',
      movementType: 'adjustment',
      sourceDocType: 'test.adj',
      idempotencyKey: key,
    };
    const first = await withStockActorContext(pool, stockSystemContext(), (c) =>
      postMovement(c, entry),
    );
    const second = await withStockActorContext(pool, stockSystemContext(), (c) =>
      postMovement(c, entry),
    );
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.movementId).toBe(first.movementId);
    const { rows } = await pool.query<{ n: string }>(
      'select count(*) as n from stock.stock_movements where idempotency_key = $1',
      [key],
    );
    expect(Number(rows[0]!.n)).toBe(1);

    // Reusing the same key with different parameters is a caller bug, not a retry.
    await expect(
      withStockActorContext(pool, stockSystemContext(), (c) =>
        postMovement(c, { ...entry, quantity: '99.000000' }),
      ),
    ).rejects.toThrow(/reused with different/i);
  });

  it('picks batches first-expiry-first-out', async () => {
    const picks = await withStockActorContext(pool, stockSystemContext(), (c) =>
      pickFefo(c, sellableLocId, teaItemId, '1500.000000'),
    );
    // B1 expires 2027-01-01 (1000 available), then B2 for the remaining 500.
    expect(picks.shortfall).toBe('0.000000');
    expect(picks.picks).toHaveLength(2);
    expect(Number(picks.picks[0]!.quantity)).toBe(1000);
    expect(Number(picks.picks[1]!.quantity)).toBe(500);
  });

  it('rebuilds balance projections from the ledger', async () => {
    const before = await getItemBalances(pool, sys, teaItemId);
    const beforeTotal = before.reduce((s, b) => s + Number(b.onHand), 0);
    await rebuildProjections(pool, ORG);
    const after = await getItemBalances(pool, sys, teaItemId);
    const afterTotal = after.reduce((s, b) => s + Number(b.onHand), 0);
    expect(afterTotal).toBe(beforeTotal);
  });

  it('serialises concurrent posts to the same position', async () => {
    const item = await createItem(pool, sys, {
      organizationId: ORG,
      sku: `SUGAR-${S}`,
      name: 'Sugar',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
    });
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withStockActorContext(pool, stockSystemContext(), (c) =>
          postMovement(c, {
            organizationId: ORG,
            stockLocationId: sellableLocId,
            itemId: item.id,
            quantity: '25.000000',
            movementType: 'adjustment',
            sourceDocType: 'test.concurrency',
            idempotencyKey: `conc-${S}-${String(i)}`,
          }),
        ),
      ),
    );
    const { rows } = await pool.query<{ on_hand: string }>(
      'select on_hand from stock.stock_balances where item_id = $1 and stock_location_id = $2',
      [item.id, sellableLocId],
    );
    expect(Number(rows[0]!.on_hand)).toBe(200);
  });
});
