import { z } from 'zod';
import { createItem, listItems } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(request: Request) {
  try {
    const actor = await currentStockActor();
    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    return apiJson({
      items: await listItems(stockDb(), actor, {
        organizationId: actor.organizationId,
        limit: Number(url.searchParams.get('limit') ?? '100'),
        ...(search ? { search } : {}),
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const createSchema = z.object({
  brandId: z.uuid().nullish(),
  sku: z.string().min(1).max(60),
  name: z.string().min(1).max(160),
  itemType: z.enum([
    'raw_material',
    'packaged_product',
    'packaging',
    'consumable',
    'finished_good',
    'intermediate',
  ]),
  dimension: z.enum(['mass', 'volume', 'count']),
  baseUnit: z.string().min(1).max(20),
  supplyRule: z.enum(['jksh_required', 'local_purchase', 'flexible']).optional(),
  isBatchTracked: z.boolean().optional(),
  isReturnable: z.boolean().optional(),
  shelfLifeDays: z.number().int().positive().nullish(),
  orderPack: z.number().positive().nullish(),
  gstRate: z.union([z.string(), z.number()]).optional(),
  hsnCode: z.string().max(20).nullish(),
  purchaseUnit: z.string().max(20).nullish(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = createSchema.parse(await request.json());
    return apiJson(
      await createItem(stockDb(), actor, clean({ organizationId: actor.organizationId, ...body })),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
