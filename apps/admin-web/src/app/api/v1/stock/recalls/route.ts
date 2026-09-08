import { z } from 'zod';
import { draftRecall } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  itemId: z.uuid(),
  batchId: z.uuid(),
  reason: z.string().min(1).max(300),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await draftRecall(stockDb(), actor, clean({ organizationId: actor.organizationId, ...body })),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
