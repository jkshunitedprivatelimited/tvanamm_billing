import { z } from 'zod';
import { setStockFeatureFlag } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

const bodySchema = z.object({
  key: z.string().min(1).max(64),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    if (stockActor.role !== 'central_admin') {
      return apiJson({ error: 'forbidden', message: 'Central Admin only' }, { status: 403 });
    }
    const body = bodySchema.parse(await request.json());
    await setStockFeatureFlag(stockDb(), stockActor, body.key, body.enabled, body.config);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
