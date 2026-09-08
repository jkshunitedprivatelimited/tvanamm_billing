import { z } from 'zod';
import { createWarehouse } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  timezone: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createWarehouse(
        stockDb(),
        actor,
        clean({ organizationId: actor.organizationId, ...body }),
      ),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
