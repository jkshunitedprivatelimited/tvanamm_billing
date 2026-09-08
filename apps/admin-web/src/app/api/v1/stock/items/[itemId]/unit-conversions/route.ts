import { z } from 'zod';
import { setItemUnitConversion } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({ fromUnit: z.string().min(1).max(20), toBaseQty: z.number().positive() });

export async function POST(request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    assertSameOrigin(request);
    const { itemId } = await ctx.params;
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    await setItemUnitConversion(stockDb(), actor, { itemId, ...body });
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
