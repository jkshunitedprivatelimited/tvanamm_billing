import { saveOpeningStock } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';
export async function POST(request: Request, context: { params: Promise<{ outletId: string }> }) {
  try {
    assertSameOrigin(request);
    const { outletId } = await context.params;
    const actor = await stockActorFor(await actorOrThrow(), { outletId });
    return apiJson(await saveOpeningStock(stockDb(), actor, outletId, await request.json()));
  } catch (error) {
    return jsonError(error);
  }
}
