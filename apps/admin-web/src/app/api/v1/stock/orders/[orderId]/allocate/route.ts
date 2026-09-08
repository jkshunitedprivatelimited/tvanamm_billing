import { z } from 'zod';
import { allocateStockOrder } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({ warehouseId: z.uuid() });

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    const { warehouseId } = schema.parse(await request.json());
    return apiJson(
      await allocateStockOrder(stockDb(), await currentStockActor(), orderId, warehouseId),
    );
  } catch (error) {
    return jsonError(error);
  }
}
