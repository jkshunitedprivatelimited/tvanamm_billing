import { z } from 'zod';
import { enterCountLine } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  itemId: z.uuid(),
  batchId: z.uuid().nullish(),
  countedQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
  reason: z.string().max(200).nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ countId: string }> }) {
  try {
    assertSameOrigin(request);
    const { countId } = await ctx.params;
    const body = schema.parse(await request.json());
    return apiJson(await enterCountLine(stockDb(), await currentStockActor(), countId, body));
  } catch (error) {
    return jsonError(error);
  }
}
