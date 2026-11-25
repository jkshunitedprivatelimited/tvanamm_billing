import { setTimeout as sleep } from 'node:timers/promises';
import { createPool, createStockPool } from '@jksh/db';
import { runStockEventCycle, monitorStockWorker } from '@jksh/stock';

// Environment supplied by the supervisor; never loads the local shared .env.
if (process.env.NODE_ENV === 'production' && !process.env.STOCK_EVENT_SECRET)
  throw new Error('STOCK_EVENT_SECRET is required for production event processing');
if (process.env.DATABASE_URL === process.env.STOCK_DATABASE_URL)
  throw new Error('Billing and Stock must use separate databases');
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
      const result = await monitorStockWorker(stock, 'events', () =>
        runStockEventCycle(billing, stock),
      );
      console.info('[stock-events]', result);
      if (
        once &&
        (result.delivery.failed || result.inbox.failed || result.reason === 'invalid_scope')
      )
        process.exitCode = 1;
    } catch {
      console.error(
        '[stock-events] cycle failed; inspect queue health and deployment configuration',
      );
      if (once) process.exitCode = 1;
    }
    if (!once && !abort.signal.aborted)
      await sleep(30_000, undefined, { signal: abort.signal }).catch(() => undefined);
  } while (!once && !abort.signal.aborted);
} finally {
  await Promise.all([billing.end(), stock.end()]);
}
