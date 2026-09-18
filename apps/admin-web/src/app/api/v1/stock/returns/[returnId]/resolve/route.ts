import { z } from 'zod';
import { resolveReturn } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  outcome: z.enum(['credited', 'replaced', 'rejected']),
  creditAmountPaise: z.number().int().nonnegative().nullish(),
  note: z.string().max(500).nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    assertSameOrigin(request);
    const { returnId } = await ctx.params;
    const body = schema.parse(await request.json());
    return apiJson(await resolveReturn(stockDb(), await currentStockActor(), returnId, body));
  } catch (error) {
    return jsonError(error);
  }
}
