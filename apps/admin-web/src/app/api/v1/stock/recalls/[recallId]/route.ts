import { getRecall } from '@jksh/stock';
import { apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ recallId: string }> }) {
  try {
    const { recallId } = await ctx.params;
    return apiJson(await getRecall(stockDb(), await currentStockActor(), recallId));
  } catch (error) {
    return jsonError(error);
  }
}
