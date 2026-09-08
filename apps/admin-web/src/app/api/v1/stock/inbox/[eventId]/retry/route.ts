import { processStockInbox, retryInboxDeadLetter } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    if (stockActor.role !== 'central_admin') {
      return apiJson({ error: 'forbidden', message: 'Central Admin only' }, { status: 403 });
    }
    const { eventId } = await ctx.params;
    const requeued = await retryInboxDeadLetter(stockDb(), eventId);
    if (!requeued) {
      return apiJson({ error: 'not_found', message: 'Not a current dead-letter' }, { status: 404 });
    }
    const inbox = await processStockInbox(stockDb());
    return apiJson({ requeued: true, inbox });
  } catch (error) {
    return jsonError(error);
  }
}
