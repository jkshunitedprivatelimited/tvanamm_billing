import { z } from 'zod';
import { requestReturn, listOwnerReturns } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  itemId: z.uuid(),
  qtyBase: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .refine((v) => Number(v) > 0),
  reason: z.string().trim().min(1).max(500),
});

export async function GET(_request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    const { outletId } = await ctx.params;
    const actor = await currentStockActor({ outletId });
    return apiJson({ returns: await listOwnerReturns(stockDb(), actor, outletId) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    assertSameOrigin(request);
    const { outletId } = await ctx.params;
    const actor = await currentStockActor({ outletId });
    if (!actor.franchiseId) {
      return apiJson({ error: 'forbidden', message: 'No franchise in scope' }, { status: 403 });
    }
    const body = schema.parse(await request.json());
    return apiJson(
      await requestReturn(
        stockDb(),
        actor,
        clean({
          organizationId: actor.organizationId,
          outletId,
          franchiseId: actor.franchiseId,
          ...body,
        }),
      ),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
