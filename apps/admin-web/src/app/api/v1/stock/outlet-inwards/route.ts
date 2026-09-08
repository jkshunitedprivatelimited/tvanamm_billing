import { z } from 'zod';
import { recordOutletInward } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  stockOrderId: z.uuid(),
  stockDispatchId: z.uuid(),
  outletId: z.uuid(),
  franchiseId: z.uuid(),
  inwardNumber: z.string().min(1).max(60),
  lines: z
    .array(
      z.object({
        stockDispatchLineId: z.uuid(),
        acceptedQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
        shortQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
        damagedQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
        excessQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
        rejectedQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = schema.parse(await request.json());
    const actor = await currentStockActor({ outletId: body.outletId });
    return apiJson(
      await recordOutletInward(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
