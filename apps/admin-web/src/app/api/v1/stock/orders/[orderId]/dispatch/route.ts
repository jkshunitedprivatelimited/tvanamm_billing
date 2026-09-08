import { z } from 'zod';
import { dispatchStockOrder } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  dispatchNumber: z.string().min(1).max(60),
  warehouseId: z.uuid(),
});

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    const body = schema.parse(await request.json());
    return apiJson(await dispatchStockOrder(stockDb(), await currentStockActor(), orderId, body));
  } catch (error) {
    return jsonError(error);
  }
}
