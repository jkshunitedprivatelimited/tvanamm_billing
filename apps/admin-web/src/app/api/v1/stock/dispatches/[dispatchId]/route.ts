import { getDispatch } from '@jksh/stock';
import { apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ dispatchId: string }> }) {
  try {
    const { dispatchId } = await ctx.params;
    return apiJson(await getDispatch(stockDb(), await currentStockActor(), dispatchId));
  } catch (error) {
    return jsonError(error);
  }
}
