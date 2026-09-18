import { closeStockOrder } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    return apiJson(await closeStockOrder(stockDb(), await currentStockActor(), orderId));
  } catch (error) {
    return jsonError(error);
  }
}
