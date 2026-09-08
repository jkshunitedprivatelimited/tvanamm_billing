import { getItemBalances } from '@jksh/stock';
import { apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    const { itemId } = await ctx.params;
    const actor = await currentStockActor();
    return apiJson({ balances: await getItemBalances(stockDb(), actor, itemId) });
  } catch (error) {
    return jsonError(error);
  }
}
