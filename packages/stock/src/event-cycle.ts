import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type Pool, type StockPool } from '@jksh/db';
import { deliverBillingEventsToStock, processStockInbox } from './relay';
import { consumeStockResults } from './sync-results';

const schema = z.object({
  organizationId: z.uuid(),
  outletIds: z.array(z.uuid()).min(1).max(500),
  notBefore: z.iso.datetime({ offset: true }),
});

/** Hosted and manual processing use the same explicit, bounded pilot scope. */
export async function runStockEventCycle(billing: Pool, stock: StockPool, organizationId?: string) {
  const rows = await withStockActorContext(
    stock,
    stockSystemContext(),
    async (client) =>
      (
        await client.query<{ key: string; enabled: boolean; config: unknown }>(
          "select key,enabled,config from stock.feature_flags where key in ('stock.enabled','stock.events.enabled')",
        )
      ).rows,
  );
  const master = rows.find((r) => r.key === 'stock.enabled');
  const events = rows.find((r) => r.key === 'stock.events.enabled');
  const empty = {
    delivery: { delivered: 0, skipped: 0, failed: 0, deadLettered: 0 },
    inbox: { processed: 0, failed: 0, deadLettered: 0 },
    results: { recorded: 0, failed: 0, deadLettered: 0 },
  };
  if (!master?.enabled || !events?.enabled) return { paused: true, reason: 'disabled', ...empty };
  const scope = schema.safeParse(events.config);
  if (!scope.success || (organizationId && scope.data.organizationId !== organizationId))
    return { paused: true, reason: 'invalid_scope', ...empty };
  const delivery = await deliverBillingEventsToStock(billing, stock, { scope: scope.data });
  const inbox = await processStockInbox(stock, { scope: scope.data });
  const results = await consumeStockResults(billing, stock);
  return { paused: false, reason: null, delivery, inbox, results };
}
