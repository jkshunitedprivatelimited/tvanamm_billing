import { z } from 'zod';
import { publishRecipeVersion } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  servingQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
  servingUnit: z.string().min(1).max(20),
  batchYieldBase: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .nullish(),
  preparedBaseItemId: z.uuid().nullish(),
  preparedBaseQtyBase: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/)
    .nullish(),
  yieldUnverified: z.boolean().optional(),
  components: z
    .array(
      z.object({
        componentType: z.enum(['fixed', 'optional', 'alternative', 'addon', 'packaging']),
        itemId: z.uuid(),
        qtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
        alternativeGroup: z.string().max(60).nullish(),
        isDefault: z.boolean().optional(),
        processLossPct: z.number().min(0).max(99).optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  try {
    assertSameOrigin(request);
    const { recipeId } = await ctx.params;
    const body = schema.parse(await request.json());
    return apiJson(
      await publishRecipeVersion(stockDb(), await currentStockActor(), recipeId, body),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
