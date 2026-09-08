import { z } from 'zod';
import { quarantineRecallLocation } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({ stockLocationId: z.uuid() });

export async function POST(request: Request, ctx: { params: Promise<{ recallId: string }> }) {
  try {
    assertSameOrigin(request);
    const { recallId } = await ctx.params;
    const { stockLocationId } = schema.parse(await request.json());
    return apiJson(
      await quarantineRecallLocation(
        stockDb(),
        await currentStockActor(),
        recallId,
        stockLocationId,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
