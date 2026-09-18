import { z } from 'zod';
import { receiveReturn } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  note: z.string().max(500).nullish(),
});

export async function POST(request: Request, ctx: { params: Promise<{ returnId: string }> }) {
  try {
    assertSameOrigin(request);
    const { returnId } = await ctx.params;
    const body = schema.parse(await request.json().catch(() => ({})));
    return apiJson(await receiveReturn(stockDb(), await currentStockActor(), returnId, body.note));
  } catch (error) {
    return jsonError(error);
  }
}
