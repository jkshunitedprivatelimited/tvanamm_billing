/**
 * Owner-return lifecycle against a real Postgres: requested -> approved ->
 * collected -> received -> credited/replaced/rejected, each step gated to a
 * different party so the outlet that raises a return can never approve,
 * value, or remove it from its own books. Runs only when STOCK_DATABASE_URL
 * is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { createItem, configureOutletStock, getItemBalances } from './inventory';
import { postMovements } from './ledger';
import {
  collectReturn,
  decideReturn,
  receiveReturn,
  requestReturn,
  resolveReturn,
} from './returns';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const FRANCHISE = '02000000-0000-4000-8000-000000000002';
const OUTLET = '03000000-0000-4000-8000-000000000003';
const S = Date.now().toString(36);

let pool: StockPool;
let sys: StockActor;
let itemId: string;
let nonReturnableItemId: string;
let sellableLocationId: string;

const owner: StockActor = {
  request: 'admin',
  role: 'franchise_owner',
  accountId: '00000001-0000-4000-8000-000000000001',
  organizationId: ORG,
  franchiseId: FRANCHISE,
  outletId: OUTLET,
  warehouseIds: [],
};
const manager: StockActor = {
  request: 'admin',
  role: 'warehouse_manager',
  accountId: '00000002-0000-4000-8000-000000000002',
  organizationId: ORG,
  warehouseIds: [],
};
const staff: StockActor = {
  request: 'admin',
  role: 'warehouse_staff',
  accountId: '00000003-0000-4000-8000-000000000003',
  organizationId: ORG,
  warehouseIds: [],
};

async function onHand(item: string): Promise<number> {
  const rows = await getItemBalances(pool, sys, item);
  return rows
    .filter((r) => r.stockLocationId === sellableLocationId)
    .reduce((s, r) => s + Number(r.onHand), 0);
}

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  sys = stockSystemActor(ORG);

  const outlet = await configureOutletStock(pool, sys, {
    outletId: OUTLET,
    organizationId: ORG,
    franchiseId: FRANCHISE,
  });
  sellableLocationId = outlet.sellableLocationId;

  itemId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `RETITEM-${S}`,
      name: 'Returnable Cups',
      itemType: 'packaging',
      dimension: 'count',
      baseUnit: 'each',
      isReturnable: true,
    })
  ).id;
  nonReturnableItemId = (
    await createItem(pool, sys, {
      organizationId: ORG,
      sku: `NORETITEM-${S}`,
      name: 'Opened Syrup',
      itemType: 'raw_material',
      dimension: 'volume',
      baseUnit: 'ml',
      isReturnable: false,
    })
  ).id;

  await postMovements(pool, [
    {
      organizationId: ORG,
      stockLocationId: sellableLocationId,
      itemId,
      quantity: '500',
      movementType: 'opening',
      sourceDocType: 'test.seed',
      idempotencyKey: `retseed-${S}`,
    },
    {
      organizationId: ORG,
      stockLocationId: sellableLocationId,
      itemId: nonReturnableItemId,
      quantity: '500',
      movementType: 'opening',
      sourceDocType: 'test.seed',
      idempotencyKey: `retseed2-${S}`,
    },
  ]);
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Owner returns', () => {
  it('rejects a request for a non-returnable item', async () => {
    await expect(
      requestReturn(pool, owner, {
        organizationId: ORG,
        outletId: OUTLET,
        franchiseId: FRANCHISE,
        itemId: nonReturnableItemId,
        qtyBase: '10',
        reason: 'opened by mistake',
      }),
    ).rejects.toThrow(/not eligible/i);
  });

  it('never lets the requesting owner approve, collect, or resolve their own return', async () => {
    const req = await requestReturn(pool, owner, {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      itemId,
      qtyBase: '20',
      reason: 'self-approval probe',
    });
    await expect(decideReturn(pool, owner, req.id, { action: 'approve' })).rejects.toThrow(
      /missing capability/i,
    );
    await expect(collectReturn(pool, owner, req.id)).rejects.toThrow(/missing capability/i);
    await expect(receiveReturn(pool, owner, req.id)).rejects.toThrow(/missing capability/i);
    await expect(
      resolveReturn(pool, owner, req.id, { outcome: 'credited', creditAmountPaise: 100 }),
    ).rejects.toThrow(/missing capability/i);

    // Clean up: a Central/warehouse actor rejects it so it doesn't linger.
    await decideReturn(pool, manager, req.id, { action: 'reject' });
  });

  it('only removes outlet stock at collection, not at approval, and lets warehouse staff (not just central) collect', async () => {
    const before = await onHand(itemId);
    const req = await requestReturn(pool, owner, {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      itemId,
      qtyBase: '30',
      reason: 'wrong item delivered',
    });

    await decideReturn(pool, manager, req.id, { action: 'approve' });
    expect(await onHand(itemId)).toBe(before); // stock untouched by approval alone

    await collectReturn(pool, staff, req.id);
    expect(await onHand(itemId)).toBe(before - 30);

    await receiveReturn(pool, manager, req.id, 'matches what was approved');
    const resolved = await resolveReturn(pool, manager, req.id, {
      outcome: 'credited',
      creditAmountPaise: 4500,
      note: 'credited to next invoice',
    });
    expect(resolved.status).toBe('credited');
    expect(await onHand(itemId)).toBe(before - 30); // credit doesn't touch stock again
  });

  it('reverses the collection movement when inspection rejects the return', async () => {
    const before = await onHand(itemId);
    const req = await requestReturn(pool, owner, {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      itemId,
      qtyBase: '15',
      reason: 'excess stock',
    });
    await decideReturn(pool, manager, req.id, { action: 'approve' });
    await collectReturn(pool, manager, req.id);
    expect(await onHand(itemId)).toBe(before - 15);

    await receiveReturn(pool, manager, req.id, 'goods damaged beyond what was approved');
    const resolved = await resolveReturn(pool, manager, req.id, {
      outcome: 'rejected',
      note: 'condition did not match the approved request',
    });
    expect(resolved.status).toBe('rejected');
    expect(await onHand(itemId)).toBe(before); // reversed back to the outlet
  });

  it('rejects out-of-order transitions and duplicate decisions', async () => {
    const req = await requestReturn(pool, owner, {
      organizationId: ORG,
      outletId: OUTLET,
      franchiseId: FRANCHISE,
      itemId,
      qtyBase: '5',
      reason: 'sequencing probe',
    });
    // Can't collect before approval.
    await expect(collectReturn(pool, manager, req.id)).rejects.toThrow(/expected approved/i);

    await decideReturn(pool, manager, req.id, { action: 'approve' });
    // Can't approve twice.
    await expect(decideReturn(pool, manager, req.id, { action: 'approve' })).rejects.toThrow(
      /expected requested/i,
    );

    await collectReturn(pool, manager, req.id);
    await receiveReturn(pool, manager, req.id);
    await resolveReturn(pool, manager, req.id, {
      outcome: 'replaced',
      note: 'new unit dispatched',
    });
    // Terminal: can't resolve again.
    await expect(
      resolveReturn(pool, manager, req.id, { outcome: 'credited', creditAmountPaise: 100 }),
    ).rejects.toThrow(/expected received/i);
  });
});
