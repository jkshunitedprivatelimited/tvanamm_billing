import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';

/** Hosted workers only: a manual relay must not imply that a scheduler is alive.
 * No provider payloads or raw error messages are persisted. */
export async function monitorStockWorker<
  T extends {
    paused: boolean;
    failed?: number;
    delivery?: { failed: number };
    inbox?: { failed: number };
  },
>(pool: StockPool, worker: 'events' | 'alerts', run: () => Promise<T>): Promise<T> {
  const flag = await withStockActorContext(
    pool,
    stockSystemContext(),
    async (client) =>
      (
        await client.query<{ config: unknown }>(
          'select config from stock.feature_flags where key=$1',
          [`stock.${worker}.enabled`],
        )
      ).rows[0],
  );
  const scope = z.object({ organizationId: z.uuid() }).safeParse(flag?.config);
  // No configured organization means there is no owner to attach a heartbeat to.
  if (!scope.success) return run();
  const organizationId = scope.data.organizationId;
  const runId = randomUUID();
  await withStockActorContext(pool, stockSystemContext(), (client) =>
    client.query(
      `insert into stock.worker_status(worker,organization_id,run_id,state) values($1,$2,$3,'running')
     on conflict(worker,organization_id) do update set run_id=excluded.run_id,state='running',started_at=now(),finished_at=null`,
      [worker, organizationId, runId],
    ),
  );
  const finish = (state: 'completed' | 'paused' | 'failed') =>
    withStockActorContext(pool, stockSystemContext(), (client) =>
      client.query(
        `update stock.worker_status set state=$4,finished_at=now(),
       last_success_at=case when $4='completed' then now() else last_success_at end
       where worker=$1 and organization_id=$2 and run_id=$3`,
        [worker, organizationId, runId, state],
      ),
    );
  try {
    const result = await run();
    await finish(
      result.paused
        ? 'paused'
        : result.failed || result.delivery?.failed || result.inbox?.failed
          ? 'failed'
          : 'completed',
    );
    return result;
  } catch (error) {
    await finish('failed').catch(() => undefined);
    throw error;
  }
}
