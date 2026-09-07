import { getSupplyCatalogForOutlet } from '@jksh/stock';
import { actorOrThrow, apiJson, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    const { outletId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor, { outletId });
    return apiJson({ items: await getSupplyCatalogForOutlet(stockDb(), stockActor, outletId) });
  } catch (error) {
    return jsonError(error);
  }
}
