import { z } from 'zod';
import { recordProductionOutput } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';
const schema = z.object({
  outputBatchCode: z.string().trim().min(1).max(80),
  expiryDate: z.string().date().nullish(),
  acceptedQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
  rejectedQtyBase: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .optional(),
});
export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const id = z.uuid().parse((await ctx.params).orderId);
    return apiJson(
      await recordProductionOutput(
        stockDb(),
        await currentStockActor(),
        id,
        schema.parse(await request.json()),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
