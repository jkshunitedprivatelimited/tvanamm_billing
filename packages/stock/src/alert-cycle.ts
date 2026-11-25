import { z } from 'zod';
import { withStockActorContext, stockSystemContext, type StockPool } from '@jksh/db';
import type { LowStockEvent } from '@jksh/contracts';
import { scanLowStockRules, deliverLowStockEvents } from './low-stock';

// Explicit IDs only: an absent/empty/malformed configuration never means all outlets.
const scopeSchema = z.object({
  organizationId: z.uuid(),
  outletIds: z.array(z.uuid()).min(1).max(500),
});

/** A pause preserves pending low/resolved events. Resuming delivers them in
 * per-rule order, so disabling a worker cannot silently discard recovery notices.
 * Configuration changes take effect on the next bounded worker cycle. */
export async function runLowStockAlertCycle(
  pool: StockPool,
  receive: (event: LowStockEvent) => Promise<void>,
) {
  const flags = await withStockActorContext(pool, stockSystemContext(), async (client) => {
    const { rows } = await client.query<{ key: string; enabled: boolean; config: unknown }>(
      "select key, enabled, config from stock.feature_flags where key in ('stock.enabled', 'stock.alerts.enabled')",
    );
    return rows;
  });
  const master = flags.find((flag) => flag.key === 'stock.enabled');
  const alerts = flags.find((flag) => flag.key === 'stock.alerts.enabled');
  if (!master?.enabled || !alerts?.enabled)
    return { paused: true, reason: 'disabled', scanned: 0, delivered: 0, failed: 0 };
  const scope = scopeSchema.safeParse(alerts.config);
  if (!scope.success)
    return { paused: true, reason: 'invalid_scope', scanned: 0, delivered: 0, failed: 0 };
  const scanned = await scanLowStockRules(pool, 500, scope.data);
  const delivery = await deliverLowStockEvents(pool, receive, 100, scope.data);
  return { paused: false, reason: null, scanned, ...delivery };
}
