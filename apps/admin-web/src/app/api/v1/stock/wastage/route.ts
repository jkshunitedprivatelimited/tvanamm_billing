import { z } from 'zod';
import { recordWastage } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  stockLocationId: z.uuid(),
  itemId: z.uuid(),
  batchId: z.uuid().nullish(),
  qtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
  reason: z.enum([
    'spoilage',
    'breakage',
    'expiry',
    'preparation_loss',
    'customer_cancelled',
    'pest',
    'other',
  ]),
  evidenceUrl: z.string().max(500).nullish(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await recordWastage(
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
