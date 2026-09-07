import { deliverBillingEventsToStock, processStockInbox, reconcileCrossSystem } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';

/**
 * Central operational endpoint: drain Billing's sale-event outbox into the Stock
 * inbox, process it, and record a reconciliation run. In production a scheduled
 * worker calls this; here it is a manual trigger for the pilot.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    if (stockActor.role !== 'central_admin') {
      return apiJson({ error: 'forbidden', message: 'Central Admin only' }, { status: 403 });
    }
    const delivery = await deliverBillingEventsToStock(db(), stockDb());
    const inbox = await processStockInbox(stockDb());
    const reconciliation = await reconcileCrossSystem(stockDb(), stockActor.organizationId);
    return apiJson({ delivery, inbox, reconciliation });
  } catch (error) {
    return jsonError(error);
  }
}
