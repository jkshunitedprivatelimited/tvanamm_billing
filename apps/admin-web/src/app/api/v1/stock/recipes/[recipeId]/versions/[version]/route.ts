import { getPublishedRecipe } from '@jksh/stock';
import { apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ recipeId: string; version: string }> },
) {
  try {
    const { recipeId, version } = await ctx.params;
    return apiJson(
      await getPublishedRecipe(stockDb(), await currentStockActor(), recipeId, Number(version)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
