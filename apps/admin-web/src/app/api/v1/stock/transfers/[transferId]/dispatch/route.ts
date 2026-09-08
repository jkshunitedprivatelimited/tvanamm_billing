import { dispatchTransfer } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ transferId: string }> }) {
  try {
    assertSameOrigin(request);
    const { transferId } = await ctx.params;
    await dispatchTransfer(stockDb(), await currentStockActor(), transferId);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
