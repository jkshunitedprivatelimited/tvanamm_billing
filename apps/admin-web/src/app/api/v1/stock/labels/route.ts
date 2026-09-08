import { z } from 'zod';
import { recordLabelJob } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  itemId: z.uuid(),
  batchId: z.uuid().nullish(),
  quantity: z.number().int().positive(),
  template: z.string().min(1).max(60),
  paperMm: z.union([z.literal(38), z.literal(50), z.literal(58), z.literal(80)]).optional(),
  label: z.object({
    itemName: z.string().min(1),
    sku: z.string().min(1),
    batchCode: z.string().max(80).nullish(),
    expiryDate: z.string().max(20).nullish(),
    barcodeValue: z.string().min(1),
    paperMm: z.union([z.literal(38), z.literal(50), z.literal(58), z.literal(80)]).optional(),
  }),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await recordLabelJob(
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
