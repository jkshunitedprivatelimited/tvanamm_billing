import { recipeEditorDraftSchema, type RecipeEditorDraft } from '@jksh/contracts';
import { withStockActorContext, type StockPool } from '@jksh/db';
import { ensureStockAllowed, stockContextForActor, type StockActor } from './authorize';
import { StockError } from './errors';
import { recordStockAudit } from './audit';

export async function readRecipeEditorDraft(pool: StockPool, actor: StockActor, recipeId: string) {
  ensureStockAllowed(actor, 'stock.recipe.manage');
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const result = await client.query<{
      version_draft: unknown;
      version_draft_revision: number;
      version_draft_base_version: number | null;
      current_version: number;
    }>(
      `select version_draft, version_draft_revision, version_draft_base_version, current_version
       from stock.recipes where id=$1 and organization_id=$2`,
      [recipeId, actor.organizationId],
    );
    const row = result.rows[0];
    if (!row) throw new StockError('not_found', 'Recipe not found');
    return {
      draft: row.version_draft == null ? null : recipeEditorDraftSchema.parse(row.version_draft),
      revision: row.version_draft_revision,
      baseVersion: row.version_draft_base_version ?? row.current_version,
      currentVersion: row.current_version,
    };
  });
}

export async function saveRecipeEditorDraft(
  pool: StockPool,
  actor: StockActor,
  recipeId: string,
  input: { revision: number; baseVersion: number; draft: RecipeEditorDraft },
) {
  ensureStockAllowed(actor, 'stock.recipe.manage');
  const draft = recipeEditorDraftSchema.parse(input.draft);
  return withStockActorContext(pool, stockContextForActor(actor), async (client) => {
    const result = await client.query<{ version_draft_revision: number }>(
      `update stock.recipes set version_draft=$3, version_draft_revision=version_draft_revision+1,
        version_draft_base_version=$4
       where id=$1 and organization_id=$2 and version_draft_revision=$5 and current_version=$4
       returning version_draft_revision`,
      [recipeId, actor.organizationId, JSON.stringify(draft), input.baseVersion, input.revision],
    );
    const row = result.rows[0];
    if (!row)
      throw new StockError(
        'conflict',
        'Recipe or draft changed. Reload before editing to avoid overwriting another review.',
      );
    await recordStockAudit(client, {
      action: 'recipe.version_draft_saved',
      actorRequest: actor.request,
      accountId: actor.accountId,
      organizationId: actor.organizationId,
      subjectType: 'recipe',
      subjectId: recipeId,
      data: { revision: row.version_draft_revision, baseVersion: input.baseVersion },
    });
    return { revision: row.version_draft_revision };
  });
}
