import { z } from 'zod';
import { resolveSupplierReturn } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  resolution: z.enum(['replacement', 'credit_note', 'refund', 'supplier_rejected']),
});

export async function POST(request: Request, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    assertSameOrigin(request);
    const { returnId } = await ctx.params;
    const { resolution } = schema.parse(await request.json());
    await resolveSupplierReturn(stockDb(), await currentStockActor(), returnId, resolution);
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
