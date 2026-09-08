import { z } from 'zod';
import { reviewLocalInward } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  action: z.enum(['confirm', 'reverse']),
  unitCostPaise: z.number().int().nonnegative().nullish(),
  supplierName: z.string().max(200).nullish(),
  invoiceNumber: z.string().max(120).nullish(),
  reason: z.string().max(300).nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ localInwardId: string }> }) {
  try {
    assertSameOrigin(request);
    const { localInwardId } = await ctx.params;
    const body = schema.parse(await request.json());
    return apiJson(
      await reviewLocalInward(stockDb(), await currentStockActor(), localInwardId, body),
    );
  } catch (error) {
    return jsonError(error);
  }
}
