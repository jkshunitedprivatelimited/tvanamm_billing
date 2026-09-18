import { publishRecipeVersionSchema } from '@jksh/contracts';
import { publishRecipeVersion } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  try {
    assertSameOrigin(request);
    const { recipeId } = await ctx.params;
    const body = publishRecipeVersionSchema.parse(await request.json());
    return apiJson(
      await publishRecipeVersion(stockDb(), await currentStockActor(), recipeId, body),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
