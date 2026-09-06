/**
 * Stock S1 foundation against a real Postgres: the capability mirror, the
 * identity projection round-trip, and exactly-once inbox ingestion.
 * Runs only when STOCK_DATABASE_URL is set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createStockPool,
  withStockActorContext,
  stockSystemContext,
  type StockPool,
} from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { STOCK_ROLE_CAPABILITIES, STOCK_ACTOR_ROLES } from '@jksh/contracts';
import { resolveStockActor, upsertIdentityProjection } from './identity-projection';
import { ingestInboundEvent } from './events';
import { stockSystemActor } from './authorize';

const RUN = !!process.env.STOCK_DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';

let pool: StockPool;

beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
});

afterAll(async () => {
  if (RUN) await pool.end();
});

describe.skipIf(!RUN)('Stock foundation', () => {
  it('mirrors STOCK_ROLE_CAPABILITIES into stock.role_capabilities exactly', async () => {
    const { rows } = await pool.query<{ role: string; capability: string }>(
      'select role, capability from stock.role_capabilities',
    );
    const dbByRole = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!dbByRole.has(r.role)) dbByRole.set(r.role, new Set());
      dbByRole.get(r.role)!.add(r.capability);
    }
    for (const role of STOCK_ACTOR_ROLES) {
      expect([...(dbByRole.get(role) ?? [])].sort()).toEqual(
        [...STOCK_ROLE_CAPABILITIES[role]].sort(),
      );
    }
  });

  it('resolves a projected warehouse role and its assignments', async () => {
    const accountId = randomUUID();
    const sys = stockSystemActor(ORG);
    await upsertIdentityProjection(pool, sys, {
      accountId,
      role: 'warehouse_manager',
      organizationId: ORG,
      displayName: 'WH Manager',
    });

    const actor = await resolveStockActor(pool, {
      request: 'admin',
      billingRole: 'accountant',
      accountId,
      organizationId: ORG,
    });
    expect(actor.role).toBe('warehouse_manager');
    expect(actor.warehouseIds).toEqual([]);

    // Re-grant flips the role; upsert is idempotent on account_id.
    await upsertIdentityProjection(pool, sys, {
      accountId,
      role: 'warehouse_staff',
      organizationId: ORG,
    });
    const actor2 = await resolveStockActor(pool, {
      request: 'admin',
      billingRole: 'accountant',
      accountId,
      organizationId: ORG,
    });
    expect(actor2.role).toBe('warehouse_staff');
  });

  it('maps a Billing role straight through when no projection exists', async () => {
    const actor = await resolveStockActor(pool, {
      request: 'operator',
      billingRole: 'store_employee',
      employeeId: randomUUID(),
      organizationId: ORG,
      outletId: randomUUID(),
    });
    expect(actor.role).toBe('store_employee');
  });

  it('lands an inbound event exactly once', async () => {
    const eventId = randomUUID();
    const envelope = {
      eventId,
      eventType: 'SaleCompleted' as const,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      source: 'billing' as const,
      correlationId: randomUUID(),
      organizationId: ORG,
      franchiseId: randomUUID(),
      outletId: randomUUID(),
      payload: { billId: randomUUID(), lines: [] },
    };

    const first = await withStockActorContext(pool, stockSystemContext(), (c) =>
      ingestInboundEvent(c, envelope),
    );
    expect(first.duplicate).toBe(false);

    const second = await withStockActorContext(pool, stockSystemContext(), (c) =>
      ingestInboundEvent(c, envelope),
    );
    expect(second.duplicate).toBe(true);
    expect(second.inboxId).toBe(first.inboxId);

    const { rows } = await pool.query(
      'select count(*)::int as n from stock_inbox.events where source_event_id = $1',
      [eventId],
    );
    expect(rows[0].n).toBe(1);
  });
});
