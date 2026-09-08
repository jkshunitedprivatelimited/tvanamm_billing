import { submitCountForReview } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ countId: string }> }) {
  try {
    assertSameOrigin(request);
    const { countId } = await ctx.params;
    await submitCountForReview(stockDb(), await currentStockActor(), countId);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
