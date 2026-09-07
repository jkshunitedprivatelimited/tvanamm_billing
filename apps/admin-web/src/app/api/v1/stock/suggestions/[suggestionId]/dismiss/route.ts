import { z } from 'zod';
import { dismissSuggestion } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

const bodySchema = z.object({
  dismissedUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ suggestionId: string }> }) {
  try {
    assertSameOrigin(request);
    const { suggestionId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    await dismissSuggestion(stockDb(), stockActor, suggestionId, body.dismissedUntil ?? null);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
