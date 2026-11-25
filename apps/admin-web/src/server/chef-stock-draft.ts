import 'server-only';
import { createHash } from 'node:crypto';
import type { ActorContext } from '@jksh/contracts';
import { IdentityError } from '@jksh/identity';
import { withStockActorContext } from '@jksh/db';
import { stockContextForActor, recordStockAudit } from '@jksh/stock';
import { stockActorFor, stockDb } from './stock';
import { readChefCollection } from './chef-sop';
import { chefDraftSchema } from './chef-sop-schema';

export async function prepareChefStockDraft(
  actor: ActorContext,
  input: { collectionId: string; itemId: string; revision: number },
): Promise<{ recipeId: string; created: boolean }> {
  // Central's collection lookup enforces organization scope before Stock access.
  const collection = await readChefCollection({ actor, id: input.collectionId });
  const item = collection.menu.find((i) => i.id === input.itemId);
  const entry = collection.entries.find((e) => e.itemId === input.itemId);
  if (!item || !entry) throw new IdentityError('not_found', 'Saved SOP not found');
  if (entry.revision !== input.revision)
    throw new IdentityError(
      'conflict',
      'The chef updated this SOP. Reload and review the latest revision.',
    );
  const parsed = chefDraftSchema.safeParse(entry.draft);
  if (!parsed.success || parsed.data.status !== 'ready')
    throw new IdentityError(
      'validation',
      'Complete and review this SOP before preparing a Stock draft.',
    );
  const stockActor = await stockActorFor(actor);
  const source = { source: 'chef_workbook', ...input, draft: parsed.data };
  // One immutable source snapshot per revision; retry never overwrites a draft
  // or a published recipe. A later chef revision produces a separate draft.
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        'chef-stock-draft',
        stockActor.organizationId,
        input.collectionId,
        input.itemId,
        input.revision,
      ]),
    )
    .digest('hex');
  const recipeId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return withStockActorContext(stockDb(), stockContextForActor(stockActor), async (client) => {
    const inserted = await client.query(
      `insert into stock.recipes(id,organization_id,name,kind,billing_menu_item_id,sop_draft,created_by)
       values ($1,$2,$3,'menu_item',$4,$5,$6) on conflict (id) do nothing returning id`,
      [
        recipeId,
        stockActor.organizationId,
        item.name,
        item.id,
        JSON.stringify(source),
        actor.accountId,
      ],
    );
    if (inserted.rowCount)
      await recordStockAudit(client, {
        action: 'recipe.chef_draft_prepared',
        actorRequest: stockActor.request,
        accountId: actor.accountId,
        organizationId: stockActor.organizationId,
        subjectType: 'recipe',
        subjectId: recipeId,
        data: { collectionId: input.collectionId, itemId: input.itemId, revision: input.revision },
      });
    return { recipeId, created: !!inserted.rowCount };
  });
}
