import { z } from 'zod';
import { createStockOrder } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

const bodySchema = z.object({
  orderNumber: z.string().min(1).max(60),
  suggestionId: z.uuid().nullish(),
  lines: z
    .array(
      z.object({
        supplyCatalogItemId: z.uuid(),
        qtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .refine((v) => Number(v) > 0, 'quantity must be positive'),
      }),
    )
    .min(1),
});

export async function POST(request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    assertSameOrigin(request);
    const { outletId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor, { outletId });
    const body = bodySchema.parse(await request.json());
    if (!stockActor.franchiseId) {
      return apiJson({ error: 'forbidden', message: 'No franchise in scope' }, { status: 403 });
    }
    const result = await createStockOrder(stockDb(), stockActor, {
      organizationId: stockActor.organizationId,
      outletId,
      franchiseId: stockActor.franchiseId,
      orderNumber: body.orderNumber,
      suggestionId: body.suggestionId ?? null,
      lines: body.lines,
    });
    return apiJson(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
