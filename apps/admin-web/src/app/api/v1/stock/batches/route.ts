import { z } from 'zod';
import { createBatch } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  itemId: z.uuid(),
  batchCode: z.string().min(1).max(80),
  manufactureDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  origin: z.enum(['received', 'produced', 'opening', 'transfer', 'local_inward']),
  supplierId: z.uuid().nullish(),
  parentBatchId: z.uuid().nullish(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createBatch(stockDb(), actor, clean({ organizationId: actor.organizationId, ...body })),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
