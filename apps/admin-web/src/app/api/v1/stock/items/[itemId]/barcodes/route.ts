import { z } from 'zod';
import { addItemBarcode } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  barcode: z.string().min(1).max(80),
  kind: z.enum(['ean', 'upc', 'qr', 'alias']).optional(),
  isPrimary: z.boolean().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  try {
    assertSameOrigin(request);
    const { itemId } = await ctx.params;
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await addItemBarcode(stockDb(), actor, {
        organizationId: actor.organizationId,
        itemId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
