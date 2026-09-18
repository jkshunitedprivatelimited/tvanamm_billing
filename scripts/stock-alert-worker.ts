import { setTimeout as sleep } from 'node:timers/promises';
import { createPool, createStockPool } from '@jksh/db';
import { scanLowStockRules, deliverLowStockEvents } from '@jksh/stock';
import { receiveLowStockNotification } from '@jksh/identity';

// Run under a process supervisor, or use --once from a one-minute scheduler.
// Supply DATABASE_URL and STOCK_DATABASE_URL through the deployment environment.
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
      const scanned = await scanLowStockRules(stock);
      const delivery = await deliverLowStockEvents(stock, (event) =>
        receiveLowStockNotification(billing, event),
      );
      console.info('[stock-alerts]', { scanned, ...delivery });
      if (delivery.failed && once) process.exitCode = 1;
    } catch (error) {
      console.error(
        '[stock-alerts] cycle failed',
        error instanceof Error ? error.message : 'Unknown error',
      );
      if (once) process.exitCode = 1;
    }
    if (!once && !abort.signal.aborted)
      await sleep(30_000, undefined, { signal: abort.signal }).catch(() => undefined);
  } while (!once && !abort.signal.aborted);
} finally {
  await Promise.all([billing.end(), stock.end()]);
}
