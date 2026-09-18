import { z } from 'zod';
import { decideReturn } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().max(500).nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    assertSameOrigin(request);
    const { returnId } = await ctx.params;
    const body = schema.parse(await request.json());
    return apiJson(await decideReturn(stockDb(), await currentStockActor(), returnId, body));
  } catch (error) {
    return jsonError(error);
  }
}
