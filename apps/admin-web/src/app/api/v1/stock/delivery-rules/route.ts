import { z } from 'zod';
import { upsertDeliveryRule } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().min(1).max(120),
  kind: z.enum(['flat', 'per_outlet', 'free_over_threshold', 'free']),
  amountPaise: z.number().int().nonnegative().optional(),
  freeOverPaise: z.number().int().nonnegative().nullish(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await upsertDeliveryRule(
        stockDb(),
        actor,
        clean({ organizationId: actor.organizationId, ...body }),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
