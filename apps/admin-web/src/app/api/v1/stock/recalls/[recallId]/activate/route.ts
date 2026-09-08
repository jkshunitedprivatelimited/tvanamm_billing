import { activateRecall } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ recallId: string }> }) {
  try {
    assertSameOrigin(request);
    const { recallId } = await ctx.params;
    return apiJson(await activateRecall(stockDb(), await currentStockActor(), recallId));
  } catch (error) {
    return jsonError(error);
  }
}
