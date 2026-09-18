import { listLowStockItems, saveLowStockRule } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

interface Context {
  params: Promise<{ outletId: string }>;
}
export async function GET(_request: Request, context: Context) {
  try {
    const { outletId } = await context.params;
    const actor = await stockActorFor(await actorOrThrow(), { outletId });
    return apiJson({ items: await listLowStockItems(stockDb(), actor, outletId) });
  } catch (error) {
    return jsonError(error);
  }
}
export async function PUT(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { outletId } = await context.params;
    const actor = await stockActorFor(await actorOrThrow(), { outletId });
    await saveLowStockRule(stockDb(), actor, outletId, await request.json());
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
