import { z } from 'zod';
import { recordProductionOutput } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  outputBatchCode: z.string().min(1).max(80),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  acceptedQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
  rejectedQtyBase: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    const body = schema.parse(await request.json());
    return apiJson(
      await recordProductionOutput(stockDb(), await currentStockActor(), orderId, body),
    );
  } catch (error) {
    return jsonError(error);
  }
}
