import { runStockEventCycle, reconcileCrossSystem } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';

/**
 * Central operational endpoint: drain Billing's sale-event outbox into the Stock
 * inbox, process it, and record a reconciliation run. In production a scheduled
 * worker uses the domain functions directly; this remains a manual Central trigger.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    if (stockActor.role !== 'central_admin') {
      return apiJson({ error: 'forbidden', message: 'Central Admin only' }, { status: 403 });
    }
    const result = await runStockEventCycle(db(), stockDb(), stockActor.organizationId);
    const reconciliation = await reconcileCrossSystem(stockDb(), stockActor.organizationId);
    return apiJson({ ...result, reconciliation });
  } catch (error) {
    return jsonError(error);
  }
}
