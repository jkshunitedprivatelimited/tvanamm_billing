import { z } from 'zod';
import { createTransfer } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  fromLocationId: z.uuid(),
  toLocationId: z.uuid(),
  transferNumber: z.string().min(1).max(60),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        batchId: z.uuid().nullish(),
        qtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createTransfer(
        stockDb(),
        actor,
        clean({ organizationId: actor.organizationId, ...body }),
      ),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
