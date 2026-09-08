import { z } from 'zod';
import { createSupplier } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  name: z.string().min(1).max(200),
  gstin: z.string().max(20).nullish(),
  contactName: z.string().max(160).nullish(),
  contactPhone: z.string().max(20).nullish(),
  contactEmail: z.string().max(200).nullish(),
  paymentTermsDays: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createSupplier(
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
