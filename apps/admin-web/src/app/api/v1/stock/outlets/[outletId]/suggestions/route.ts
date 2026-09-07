import { generateReorderSuggestions, listReorderSuggestions } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    const { outletId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor, { outletId });
    return apiJson({
      suggestions: await listReorderSuggestions(stockDb(), stockActor, outletId),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    assertSameOrigin(request);
    const { outletId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor, { outletId });
    const result = await generateReorderSuggestions(stockDb(), stockActor, {
      organizationId: stockActor.organizationId,
      outletId,
    });
    return apiJson(result);
  } catch (error) {
    return jsonError(error);
  }
}
