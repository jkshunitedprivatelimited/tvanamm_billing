import 'server-only';
import type { ActorContext } from '@jksh/contracts';
import { withStockActorContext } from '@jksh/db';
import { stockContextForActor } from '@jksh/stock';
import { IdentityError } from '@jksh/identity';
import { stockDb, stockActorFor } from './stock';
import { aiDraftSchema, type AiDraft } from './ai-draft-schema';
function central(actor: ActorContext) {
  if (actor.role !== 'central_admin')
    throw new IdentityError('forbidden', 'Central admin required');
}
export async function saveRecipeDraft(actor: ActorContext, draft: AiDraft, id?: string) {
  central(actor);
  const a = await stockActorFor(actor);
  return withStockActorContext(stockDb(), stockContextForActor(a), async (c) => {
    if (id) {
      const r = await c.query<{ id: string }>(
        `update stock.recipes set name=$3,sop_draft=$4 where id=$1 and organization_id=$2 and status='draft' returning id`,
        [id, a.organizationId, draft.name, JSON.stringify(draft)],
      );
      return r.rows[0];
    }
    const r = await c.query<{ id: string }>(
      `insert into stock.recipes (organization_id,name,kind,sop_draft,created_by) values ($1,$2,$3,$4,$5) returning id`,
      [a.organizationId, draft.name, draft.kind, JSON.stringify(draft), actor.accountId],
    );
    return r.rows[0];
  });
}
export async function listRecipeDrafts(actor: ActorContext) {
  central(actor);
  const a = await stockActorFor(actor);
  return withStockActorContext(stockDb(), stockContextForActor(a), async (c) => {
    const { rows } = await c.query<{ id: string; sop_draft: unknown }>(
      `select id,sop_draft from stock.recipes where organization_id=$1 and status='draft' and sop_draft is not null order by name`,
      [a.organizationId],
    );
    return rows.flatMap((r) => {
      const parsed = aiDraftSchema.safeParse(r.sop_draft);
      return parsed.success ? [{ id: r.id, draft: parsed.data }] : [];
    });
  });
}
