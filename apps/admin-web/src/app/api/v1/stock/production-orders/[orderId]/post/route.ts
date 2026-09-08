import { postProduction } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    await postProduction(stockDb(), await currentStockActor(), orderId);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
