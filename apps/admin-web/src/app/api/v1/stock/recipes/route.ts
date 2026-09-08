import { z } from 'zod';
import { createRecipe } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  brandId: z.uuid().nullish(),
  kind: z.enum(['menu_item', 'addon', 'intermediate']),
  billingMenuItemId: z.uuid().nullish(),
  billingAddonId: z.uuid().nullish(),
  outputItemId: z.uuid().nullish(),
  name: z.string().min(1).max(160),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createRecipe(
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
