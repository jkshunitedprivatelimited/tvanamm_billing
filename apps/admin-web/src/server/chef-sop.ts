import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { ActorContext } from '@jksh/contracts';
import { IdentityError } from '@jksh/identity';
import { db } from './pool';
import {
  chefDraftSchema,
  type ChefCollection,
  type ChefItem,
  type ChefEntry,
  type ChefDraft,
} from './chef-sop-schema';
interface CollectionRow {
  id: string;
  title: string;
  menu: ChefItem[];
  expires_at: Date;
  revoked_at: Date | null;
  submitted_at: Date | null;
}
interface SummaryRow extends CollectionRow {
  created_at: Date;
  total: number;
  saved: number;
  ready: number;
}
export const hashChefToken = (t: string) => createHash('sha256').update(t).digest('hex');
function central(a: ActorContext) {
  if (a.role !== 'central_admin' || !a.accountId)
    throw new IdentityError('forbidden', 'Central workspace required');
}
export async function createChefCollection(a: ActorContext) {
  central(a);
  const menu = (
    await db().query<ChefItem>(
      `select i.id,i.name,coalesce(c.name,'Other') category from billing.catalog_items i left join billing.categories c on c.id=i.category_id where i.organization_id=$1 and i.owner_scope='master' and i.status='active' order by c.name,i.name`,
      [a.scope.organizationId],
    )
  ).rows;
  if (!menu.length)
    throw new IdentityError('validation', 'No active master menu items are available');
  const token = randomBytes(32).toString('base64url');
  const r = await db().query<{ id: string }>(
    `insert into billing.sop_collections(organization_id,created_by,title,token_hash,menu) values($1,$2,'T VANAMM · Chef SOP collection',$3,$4) returning id`,
    [a.scope.organizationId, a.accountId, hashChefToken(token), JSON.stringify(menu)],
  );
  return { id: r.rows[0]?.id ?? '', token, itemCount: menu.length };
}
export async function listChefCollections(a: ActorContext) {
  central(a);
  return (
    await db().query<SummaryRow>(
      `select c.id,c.title,c.created_at,c.expires_at,c.revoked_at,c.submitted_at,jsonb_array_length(c.menu) total,(select count(*)::int from billing.sop_collection_entries e where e.collection_id=c.id) saved,(select count(*)::int from billing.sop_collection_entries e where e.collection_id=c.id and e.draft->>'status'='ready') ready from billing.sop_collections c where c.organization_id=$1 order by created_at desc`,
      [a.scope.organizationId],
    )
  ).rows;
}
export async function closeChefCollection(a: ActorContext, id: string) {
  central(a);
  const r = await db().query(
    'update billing.sop_collections set revoked_at=coalesce(revoked_at,now()) where id=$1 and organization_id=$2 returning id',
    [id, a.scope.organizationId],
  );
  if (!r.rowCount) throw new IdentityError('not_found', 'Collection not found');
}
export async function readChefCollection(
  access: { token: string } | { actor: ActorContext; id: string },
): Promise<ChefCollection> {
  if ('actor' in access) central(access.actor);
  const r =
    'token' in access
      ? await db().query<CollectionRow>(
          `select * from billing.sop_collections where token_hash=$1 and revoked_at is null and expires_at>now()`,
          [hashChefToken(access.token)],
        )
      : await db().query<CollectionRow>(
          'select * from billing.sop_collections where id=$1 and organization_id=$2',
          [access.id, access.actor.scope.organizationId],
        );
  const c = r.rows[0];
  if (!c)
    throw new IdentityError(
      'not_found',
      'This link has expired or has been closed. Please contact the person who shared it.',
    );
  const entries = (
    await db().query<ChefEntry>(
      'select item_id "itemId",draft,revision from billing.sop_collection_entries where collection_id=$1',
      [c.id],
    )
  ).rows;
  return {
    id: c.id,
    title: c.title,
    menu: c.menu,
    entries,
    expiresAt: c.expires_at.toISOString(),
    closed: !!c.revoked_at || c.expires_at.getTime() < Date.now(),
    submitted: !!c.submitted_at,
  };
}
export async function saveChefEntry(
  token: string,
  itemId: string,
  revision: number,
  input: unknown,
) {
  const draft = chefDraftSchema.parse(input);
  const c = await db().connect();
  try {
    await c.query('begin');
    const session = (
      await c.query<CollectionRow>(
        `select id,menu,submitted_at from billing.sop_collections where token_hash=$1 and revoked_at is null and expires_at>now() for update`,
        [hashChefToken(token)],
      )
    ).rows[0];
    if (!session || session.submitted_at)
      throw new IdentityError('forbidden', 'This collection is closed for editing.');
    if (!(session.menu).some((i) => i.id === itemId))
      throw new IdentityError('forbidden', 'Item is not in this menu');
    const existing = (
      await c.query<{ revision: number }>(
        'select revision from billing.sop_collection_entries where collection_id=$1 and item_id=$2',
        [session.id, itemId],
      )
    ).rows[0];
    if ((existing?.revision ?? 0) !== revision)
      throw new IdentityError(
        'conflict',
        'This recipe changed in another tab. Reload before editing to avoid overwriting it.',
      );
    const r = await c.query<{ revision: number }>(
      `insert into billing.sop_collection_entries(collection_id,item_id,draft) values($1,$2,$3) on conflict(collection_id,item_id) do update set draft=excluded.draft,revision=billing.sop_collection_entries.revision+1,updated_at=now() returning revision`,
      [session.id, itemId, JSON.stringify(draft)],
    );
    await c.query('commit');
    return { revision: r.rows[0]?.revision ?? 0 };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
export async function submitChefCollection(token: string) {
  const c = await db().connect();
  try {
    await c.query('begin');
    const s = (
      await c.query<CollectionRow>(
        `select id,menu from billing.sop_collections where token_hash=$1 and revoked_at is null and expires_at>now() for update`,
        [hashChefToken(token)],
      )
    ).rows[0];
    if (!s) throw new IdentityError('forbidden', 'This link is closed');
    const rows = (
      await c.query<{ item_id: string; draft: ChefDraft }>(
        `select item_id,draft from billing.sop_collection_entries where collection_id=$1`,
        [s.id],
      )
    ).rows;
    const ready = new Set(
      rows
        .filter((r) => chefDraftSchema.safeParse(r.draft).success && r.draft.status === 'ready')
        .map((r) => r.item_id),
    );
    if (!(s.menu).every((i) => ready.has(i.id)))
      throw new IdentityError(
        'validation',
        'Mark every menu item ready before submitting. You can save drafts and return later.',
      );
    await c.query(
      'update billing.sop_collections set submitted_at=coalesce(submitted_at,now()) where id=$1',
      [s.id],
    );
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
