import { approveSupplier } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ supplierId: string }> }) {
  try {
    assertSameOrigin(request);
    const { supplierId } = await ctx.params;
    await approveSupplier(stockDb(), await currentStockActor(), supplierId);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
