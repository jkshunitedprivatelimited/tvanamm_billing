import { getPurchaseOrder } from '@jksh/stock';
import { apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ poId: string }> }) {
  try {
    const { poId } = await ctx.params;
    const po = await getPurchaseOrder(stockDb(), await currentStockActor(), poId);
    if (!po) return apiJson({ error: 'not_found' }, { status: 404 });
    return apiJson(po);
  } catch (error) {
    return jsonError(error);
  }
}
