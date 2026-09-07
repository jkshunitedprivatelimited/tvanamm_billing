import { reconcileStockOrderPayment } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    return apiJson(await reconcileStockOrderPayment(stockDb(), stockActor, orderId));
  } catch (error) {
    return jsonError(error);
  }
}
