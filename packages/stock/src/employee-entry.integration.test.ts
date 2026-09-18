import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { stockSystemActor, type StockActor } from './authorize';
import { configureOutletStock, createItem, getItemBalances } from './inventory';
import {
  recordEmployeeStockEntry,
  listEmployeeStockEntries,
  type EmployeeStockEntry,
  type EntryExpense,
} from './employee-entry';
import { approveCountAdjustments } from './warehouse-ops';
import { listLocalInwardsForOutlet, listWastageForOutlet } from './reads';
const ORG = '01000000-0000-4000-8000-000000000001';
let pool: StockPool;
const sys = stockSystemActor(ORG);
beforeAll(async () => {
  if (!process.env.STOCK_DATABASE_URL) return;
  pool = createStockPool();
  await stockMigrate(pool);
});
afterAll(async () => {
  if (process.env.STOCK_DATABASE_URL) await pool.end();
});
async function fixture() {
  const outletId = randomUUID(),
    franchiseId = randomUUID();
  const { sellableLocationId } = await configureOutletStock(pool, sys, {
    outletId,
    organizationId: ORG,
    franchiseId,
  });
  const item = await createItem(pool, sys, {
    organizationId: ORG,
    sku: randomUUID(),
    name: 'Employee test milk',
    itemType: 'raw_material',
    dimension: 'volume',
    baseUnit: 'ml',
    supplyRule: 'flexible',
  });
  const actor: StockActor = {
    request: 'operator',
    role: 'store_employee',
    organizationId: ORG,
    employeeId: randomUUID(),
    outletId,
    franchiseId,
    warehouseIds: [],
  };
  const owner: StockActor = {
    request: 'admin',
    role: 'franchise_owner',
    organizationId: ORG,
    franchiseId,
    accountId: randomUUID(),
    warehouseIds: [],
  };
  const command: EmployeeStockEntry = {
    id: randomUUID(),
    kind: 'purchase',
    itemId: item.id,
    quantity: '10',
    unit: 'l',
    reason: 'Morning milk',
    amount: '600.00',
    paymentSource: 'employee_paid',
  };
  const expenses = new Map<string, string>();
  async function expense(e: EntryExpense) {
    const id = expenses.get(e.idempotencyKey) ?? randomUUID();
    expenses.set(e.idempotencyKey, id);
    return { id };
  }
  async function balance() {
    return (await getItemBalances(pool, sys, item.id))
      .filter((b) => b.stockLocationId === sellableLocationId)
      .reduce((n, b) => n + Number(b.onHand), 0);
  }
  return { actor, owner, command, expenses, expense, balance, item, outletId };
}
describe.skipIf(!process.env.STOCK_DATABASE_URL)('Employee stock entries', () => {
  it('adds milk in litres once, links a single expense, and exposes recorder and amount to the owner', async () => {
    const f = await fixture();
    await Promise.all([
      recordEmployeeStockEntry(pool, f.actor, 'Anvesh', f.command, f.expense),
      recordEmployeeStockEntry(pool, f.actor, 'Anvesh', f.command, f.expense),
    ]);
    expect(await f.balance()).toBe(10000);
    expect(f.expenses.size).toBe(1);
    const rows = await listLocalInwardsForOutlet(pool, f.owner, f.outletId);
    expect(rows[0]).toMatchObject({
      employeeName: 'Anvesh',
      totalPaid: '600.00',
      expenseId: f.expenses.values().next().value,
    });
  });
  it('recovers after the expense saves but its response is lost, without duplicating money or stock', async () => {
    const f = await fixture();
    await expect(
      recordEmployeeStockEntry(pool, f.actor, 'Anvesh', f.command, async (e) => {
        await f.expense(e);
        throw new Error('lost response');
      }),
    ).rejects.toThrow('lost response');
    expect(await f.balance()).toBe(0);
    expect((await listEmployeeStockEntries(pool, f.actor))[0]?.result).toBeNull();
    await recordEmployeeStockEntry(pool, f.actor, 'Anvesh', f.command, f.expense);
    expect(await f.balance()).toBe(10000);
    expect(f.expenses.size).toBe(1);
  });
  it('rejects another employee replay and changes to an existing request', async () => {
    const f = await fixture();
    await recordEmployeeStockEntry(pool, f.actor, 'A', f.command, f.expense);
    await expect(
      recordEmployeeStockEntry(
        pool,
        { ...f.actor, employeeId: randomUUID() },
        'B',
        f.command,
        f.expense,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      recordEmployeeStockEntry(pool, f.actor, 'A', { ...f.command, amount: '900.00' }, f.expense),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await f.balance()).toBe(10000);
  });
  it('records wastage once, never creates another expense, and submits counts without changing stock until owner approval', async () => {
    const f = await fixture();
    await recordEmployeeStockEntry(pool, f.actor, 'A', f.command, f.expense);
    const waste = {
      ...f.command,
      id: randomUUID(),
      kind: 'wastage',
      quantity: '1',
      wasteReason: 'spoilage',
      reason: 'Milk spoiled',
    };
    await recordEmployeeStockEntry(pool, f.actor, 'A', waste, f.expense);
    await recordEmployeeStockEntry(pool, f.actor, 'A', waste, f.expense);
    expect(await f.balance()).toBe(9000);
    expect(f.expenses.size).toBe(1);
    expect((await listWastageForOutlet(pool, f.owner, f.outletId))[0]).toMatchObject({
      employeeName: 'A',
      details: 'Milk spoiled',
    });
    const count = {
      ...f.command,
      id: randomUUID(),
      kind: 'count',
      quantity: '8',
      reason: 'Evening physical count',
    };
    await recordEmployeeStockEntry(pool, f.actor, 'A', count, f.expense);
    expect(await f.balance()).toBe(9000);
    await expect(approveCountAdjustments(pool, f.actor, count.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      approveCountAdjustments(pool, { ...f.owner, franchiseId: randomUUID() }, count.id),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await approveCountAdjustments(pool, f.owner, count.id);
    expect(await f.balance()).toBe(8000);
  });
  it('keeps fractional per-millilitre cost for milk bought at 65 rupees per litre', async () => {
    const f = await fixture();
    await recordEmployeeStockEntry(
      pool,
      f.actor,
      'A',
      { ...f.command, amount: '650.00' },
      f.expense,
    );
    const rows = await listLocalInwardsForOutlet(pool, f.owner, f.outletId);
    expect(rows[0]).toMatchObject({
      unitCostPaise: 6.5,
      totalPaid: '650.00',
      valuationState: 'costed',
    });
  });
  it('blocks supply-only tea powder from local purchases but allows counts', async () => {
    const f = await fixture();
    const tea = await createItem(pool, sys, {
      organizationId: ORG,
      sku: randomUUID(),
      name: 'Supply-only tea powder',
      itemType: 'raw_material',
      dimension: 'mass',
      baseUnit: 'g',
      supplyRule: 'jksh_required',
    });
    const cmd = { ...f.command, itemId: tea.id, unit: 'kg' };
    await expect(
      recordEmployeeStockEntry(pool, f.actor, 'A', cmd, f.expense),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(f.expenses.size).toBe(0);
    expect(await listEmployeeStockEntries(pool, f.actor)).toHaveLength(0);
    await expect(
      recordEmployeeStockEntry(pool, f.actor, 'A', { ...cmd, kind: 'count' }, f.expense),
    ).resolves.toMatchObject({ status: 'review' });
  });
  it('rejects invalid amounts, incompatible units and cross-organization items before saving requests', async () => {
    const f = await fixture();
    await expect(
      recordEmployeeStockEntry(pool, f.actor, 'A', { ...f.command, amount: '0.00' }, f.expense),
    ).rejects.toThrow();
    await expect(
      recordEmployeeStockEntry(pool, f.actor, 'A', { ...f.command, unit: 'kg' }, f.expense),
    ).rejects.toThrow();
    await expect(
      recordEmployeeStockEntry(
        pool,
        { ...f.actor, organizationId: randomUUID() },
        'A',
        f.command,
        f.expense,
      ),
    ).rejects.toThrow();
    expect(await listEmployeeStockEntries(pool, f.actor)).toHaveLength(0);
  });
  it('keeps linked purchases from stock-only reversal', async () => {
    const f = await fixture();
    await recordEmployeeStockEntry(pool, f.actor, 'A', f.command, f.expense);
    const { reviewLocalInward } = await import('./local-inward');
    await expect(
      reviewLocalInward(pool, f.owner, f.command.id, { action: 'reverse', reason: 'mistake' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await f.balance()).toBe(10000);
  });
});
