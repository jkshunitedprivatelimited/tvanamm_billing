import { z } from 'zod';
import { createProductionOrder } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  warehouseId: z.uuid(),
  outputItemId: z.uuid(),
  plannedQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
  recipeId: z.uuid().nullish(),
  recipeVersion: z.number().int().positive().nullish(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createProductionOrder(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
