import { collectReturn } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    assertSameOrigin(request);
    const { returnId } = await ctx.params;
    return apiJson(await collectReturn(stockDb(), await currentStockActor(), returnId));
  } catch (error) {
    return jsonError(error);
  }
}
