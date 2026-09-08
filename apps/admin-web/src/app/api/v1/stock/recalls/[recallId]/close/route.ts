import { closeRecall } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ recallId: string }> }) {
  try {
    assertSameOrigin(request);
    const { recallId } = await ctx.params;
    await closeRecall(stockDb(), await currentStockActor(), recallId);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
