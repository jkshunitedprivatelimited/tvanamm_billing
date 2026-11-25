import { z } from 'zod';
import { recipeEditorDraftSchema } from '@jksh/contracts';
import { readRecipeEditorDraft, saveRecipeEditorDraft } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';
const schema = z
  .object({
    revision: z.int().nonnegative(),
    baseVersion: z.int().nonnegative(),
    draft: recipeEditorDraftSchema,
  })
  .strict();
interface Context {
  params: Promise<{ recipeId: string }>;
}
export async function GET(_request: Request, ctx: Context) {
  try {
    const { recipeId } = await ctx.params;
    return apiJson(
      await readRecipeEditorDraft(stockDb(), await currentStockActor(), z.uuid().parse(recipeId)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
export async function POST(request: Request, ctx: Context) {
  try {
    assertSameOrigin(request);
    const { recipeId } = await ctx.params;
    const input = schema.parse(await request.json());
    return apiJson(
      await saveRecipeEditorDraft(
        stockDb(),
        await currentStockActor(),
        z.uuid().parse(recipeId),
        input,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
