import { z } from 'zod';
import { publishCatalogItem } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  brandId: z.uuid().nullish(),
  itemId: z.uuid(),
  gstInclusivePricePaise: z.number().int().nonnegative(),
  gstRate: z.union([z.string(), z.number()]).optional(),
  hsnCode: z.string().max(20).nullish(),
  orderPackBase: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .optional(),
  deliveryRuleId: z.uuid().nullish(),
  isAvailable: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await publishCatalogItem(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
