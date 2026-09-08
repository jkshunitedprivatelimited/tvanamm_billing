import { approveCountAdjustments } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ countId: string }> }) {
  try {
    assertSameOrigin(request);
    const { countId } = await ctx.params;
    return apiJson(await approveCountAdjustments(stockDb(), await currentStockActor(), countId));
  } catch (error) {
    return jsonError(error);
  }
}
