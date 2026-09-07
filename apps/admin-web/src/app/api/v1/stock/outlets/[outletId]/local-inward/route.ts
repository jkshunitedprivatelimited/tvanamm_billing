import { z } from 'zod';
import { recordLocalInward } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

const bodySchema = z.object({
  itemId: z.uuid(),
  batchCode: z.string().max(80).nullish(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  qtyBase: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .refine((v) => Number(v) > 0),
  unitCostPaise: z.number().int().nonnegative().nullish(),
  supplierName: z.string().max(200).nullish(),
  invoiceNumber: z.string().max(120).nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ outletId: string }> }) {
  try {
    assertSameOrigin(request);
    const { outletId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor, { outletId });
    if (!stockActor.franchiseId) {
      return apiJson({ error: 'forbidden', message: 'No franchise in scope' }, { status: 403 });
    }
    const body = bodySchema.parse(await request.json());
    const result = await recordLocalInward(stockDb(), stockActor, {
      organizationId: stockActor.organizationId,
      outletId,
      franchiseId: stockActor.franchiseId,
      itemId: body.itemId,
      batchCode: body.batchCode ?? null,
      expiryDate: body.expiryDate ?? null,
      qtyBase: body.qtyBase,
      unitCostPaise: body.unitCostPaise ?? null,
      supplierName: body.supplierName ?? null,
      invoiceNumber: body.invoiceNumber ?? null,
    });
    return apiJson(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
