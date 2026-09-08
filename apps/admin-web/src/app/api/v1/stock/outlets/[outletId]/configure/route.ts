import { z } from 'zod';
import { configureOutletStock } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  franchiseId: z.uuid().nullish(),
  trackingEnabled: z.boolean().optional(),
  timezone: z.string().max(64).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    assertSameOrigin(request);
    const { outletId } = await ctx.params;
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await configureOutletStock(stockDb(), actor, {
        outletId,
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
