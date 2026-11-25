import { setTimeout as sleep } from 'node:timers/promises';
import { createPool, createStockPool } from '@jksh/db';
import { runLowStockAlertCycle, monitorStockWorker } from '@jksh/stock';
import { receiveLowStockNotification } from '@jksh/identity';

// Run under a process supervisor, or use --once from a one-minute scheduler.
// Supply DATABASE_URL and STOCK_DATABASE_URL through the deployment environment.
// Requires stock.enabled and stock.alerts.enabled. The latter must carry
// config: { organizationId: UUID, outletIds: UUID[] } for the reviewed pilot.
// Missing scope pauses all scans/delivery; it never expands to every outlet.
// A pause preserves queued notices, and takes effect at the next bounded cycle.
const billing = createPool();
const stock = createStockPool();
const once = process.argv.includes('--once');
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    abort.abort();
  });
try {
  do {
    try {
      const result = await monitorStockWorker(stock, 'alerts', () =>
        runLowStockAlertCycle(stock, (event) => receiveLowStockNotification(billing, event)),
      );
      console.info('[stock-alerts]', result);
      if (once && (result.failed || result.reason === 'invalid_scope')) process.exitCode = 1;
    } catch {
      console.error(
        '[stock-alerts] cycle failed',
        'Check worker configuration and database health',
      );
      if (once) process.exitCode = 1;
    }
    if (!once && !abort.signal.aborted)
      await sleep(30_000, undefined, { signal: abort.signal }).catch(() => undefined);
  } while (!once && !abort.signal.aborted);
} finally {
  await Promise.all([billing.end(), stock.end()]);
}
