import { confirmSupplierReturnDispatch } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    assertSameOrigin(request);
    const { returnId } = await ctx.params;
    await confirmSupplierReturnDispatch(stockDb(), await currentStockActor(), returnId);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
