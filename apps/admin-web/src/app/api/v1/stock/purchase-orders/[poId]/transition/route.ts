import { z } from 'zod';
import { transitionPurchaseOrder } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  action: z.enum(['submit', 'approve', 'order', 'close', 'cancel']),
});

export async function POST(request: Request, ctx: { params: Promise<{ poId: string }> }) {
  try {
    assertSameOrigin(request);
    const { poId } = await ctx.params;
    const { action } = schema.parse(await request.json());
    return apiJson(
      await transitionPurchaseOrder(stockDb(), await currentStockActor(), poId, action),
    );
  } catch (error) {
    return jsonError(error);
  }
}
