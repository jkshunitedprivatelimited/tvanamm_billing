import { getStockOrder } from '@jksh/stock';
import { actorOrThrow, apiJson, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    return apiJson(await getStockOrder(stockDb(), stockActor, orderId));
  } catch (error) {
    return jsonError(error);
  }
}
