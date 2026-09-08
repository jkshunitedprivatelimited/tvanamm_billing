import { z } from 'zod';
import { issueProductionMaterials } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  inputs: z
    .array(
      z.object({
        itemId: z.uuid(),
        qtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
        batchId: z.uuid().nullish(),
      }),
    )
    .min(1),
});

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    const { inputs } = schema.parse(await request.json());
    await issueProductionMaterials(stockDb(), await currentStockActor(), orderId, inputs);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
