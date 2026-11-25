import { cancelStockOrder, listStockOrderRefunds } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockActorFor, stockDb } from '@/server/stock';

/** Refund history for one order (Central, accountant, owning Franchise Owner). */
export async function GET(_request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await ctx.params;
    const actor = await stockActorFor(await actorOrThrow());
    return apiJson(await listStockOrderRefunds(stockDb(), actor, orderId));
  } catch (error) {
    return jsonError(error);
  }
}

/** Cancel an order; a paid order (Central only) is refunded through Razorpay. */
export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    return apiJson(
      await cancelStockOrder(stockDb(), await currentStockActor(), orderId, await request.json()),
    );
  } catch (error) {
    return jsonError(error);
  }
}
