import { createHash, timingSafeEqual } from 'node:crypto';
import { reconcileCrossSystem, runStockEventCycle } from '@jksh/stock';
import { apiJson, jsonError } from '@/server/http';
import { db } from '@/server/pool';
import { stockDb } from '@/server/stock';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.STOCK_SCHEDULER_SECRET ?? '';
  if (secret.length < 32) return false;
  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

/**
 * Called every minute by pg_cron (Billing database, job `stock-event-cycle`)
 * through pg_net. Same work as Central's manual "Check stock updates": drain
 * Billing sale events into Stock, deduct recipe stock, send results back.
 * A cross-system reconciliation run is recorded once an hour.
 */
export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return apiJson({ error: 'unauthorized' }, { status: 401 });
    }
    const result = await runStockEventCycle(db(), stockDb());
    const hourly = new Date().getUTCMinutes() === 0;
    const reconciliation =
      !result.paused && hourly && 'organizationId' in result && result.organizationId
        ? await reconcileCrossSystem(stockDb(), result.organizationId)
        : null;
    return apiJson({ ...result, reconciliation });
  } catch (error) {
    return jsonError(error);
  }
}
