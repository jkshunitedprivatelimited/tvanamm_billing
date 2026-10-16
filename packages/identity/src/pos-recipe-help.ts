import { chefDraftSchema, type ActorContext, type PosRecipeHelp } from '@jksh/contracts';
import type { Pool } from '@jksh/db';
import { getPublishedMenu } from './menu-publish';
import { IdentityError } from './errors';

/** Read-only chef guidance; never publishes recipes or changes stock consumption. */
export async function getPosRecipeHelp(
  pool: Pool,
  actor: ActorContext,
  itemId: string,
): Promise<PosRecipeHelp> {
  if (actor.role !== 'store_employee' || !actor.outletId)
    throw new IdentityError('forbidden', 'A signed-in outlet operator is required');
  const menu = await getPublishedMenu(pool, actor, actor.outletId);
  if (!menu?.items.some((item) => item.catalogItemId === itemId))
    throw new IdentityError('not_found', 'Item is not in this outlet’s published menu');

  // Newest saved entry wins, including drafts: do not silently revive an older ready SOP.
  // Collection expiry controls chef editing links, not the lifespan of saved guidance.
  const { rows } = await pool.query<{
    draft: unknown;
    revision: number;
    updated_at: Date;
  }>(
    `select e.draft, e.revision, e.updated_at
       from billing.sop_collection_entries e
       join billing.sop_collections c on c.id = e.collection_id
      where c.organization_id = $1 and e.item_id = $2 and c.revoked_at is null
      order by e.updated_at desc, c.created_at desc, c.id desc limit 1`,
    [actor.scope.organizationId, itemId],
  );
  const entry = rows[0];
  if (!entry) return { status: 'missing' };
  const parsed = chefDraftSchema.safeParse(entry.draft);
  if (!parsed.success || parsed.data.status !== 'ready') return { status: 'not_ready' };
  return {
    status: 'ready',
    draft: parsed.data,
    revision: entry.revision,
    updatedAt: entry.updated_at.toISOString(),
  };
}
