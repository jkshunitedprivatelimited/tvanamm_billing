import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createStockPool, type StockPool } from '@jksh/db';
import { stockMigrate } from '@jksh/db/stock-migrate';
import { monitorStockWorker } from './worker-status';
import { setStockFeatureFlag } from './offline';
import { stockSystemActor } from './authorize';

const RUN = !!process.env.STOCK_DATABASE_URL;
const org = randomUUID();
let pool: StockPool;
beforeAll(async () => {
  if (!RUN) return;
  pool = createStockPool();
  await stockMigrate(pool);
  await setStockFeatureFlag(pool, stockSystemActor(org), 'stock.events.enabled', false, {
    organizationId: org,
  });
});
afterAll(async () => {
  if (RUN) {
    await setStockFeatureFlag(pool, stockSystemActor(org), 'stock.events.enabled', false, {});
    await pool.end();
  }
});

describe.skipIf(!RUN)('Hosted worker status', () => {
  it('records running, successful, paused and failed outcomes without persisting error details', async () => {
    const status = async () =>
      (
        await pool.query<{ state: string; last_success_at: Date | null }>(
          "select state,last_success_at from stock.worker_status where organization_id=$1 and worker='events'",
          [org],
        )
      ).rows[0];
    await monitorStockWorker(pool, 'events', async () => {
      expect((await status())?.state).toBe('running');
      return { paused: false };
    });
    const success = await status();
    expect(success?.state).toBe('completed');
    expect(success?.last_success_at).toBeTruthy();
    await monitorStockWorker(pool, 'events', async () => ({ paused: true }));
    expect(await status()).toEqual({ state: 'paused', last_success_at: success?.last_success_at });
    await monitorStockWorker(pool, 'events', async () => ({
      paused: false,
      delivery: { failed: 1 },
    }));
    expect((await status())?.state).toBe('failed');
    await expect(
      monitorStockWorker(pool, 'events', async () => {
        throw new Error('Private diagnostic');
      }),
    ).rejects.toThrow('Private diagnostic');
    expect(await status()).toEqual({ state: 'failed', last_success_at: success?.last_success_at });
    const raw = await pool.query('select * from stock.worker_status where organization_id=$1', [
      org,
    ]);
    expect(JSON.stringify(raw.rows)).not.toContain('Private diagnostic');
  });
});
