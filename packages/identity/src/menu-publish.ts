import { createHash, randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  CopyOutletItemToMasterCommand,
  CreatePublicationCommand,
  PosMenuSnapshot,
  PreviewPublicationCommand,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

const FORCED_FIELD_COLUMN: Record<string, string> = {
  name: 'name',
  description: 'description',
  image_url: 'image_url',
  category: 'category_id',
  price: 'price',
  availability: 'is_available',
};

interface EffectiveItem {
  catalogItemId: string;
  categoryName: string;
  categoryOrder: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  gstRate: string;
  price: string;
  isAvailable: boolean;
  availabilityNote: string | null;
  offlineSaleAllowed: boolean;
  stockRecipeId: string | null;
  stockRecipeVersion: number | null;
  addons: {
    addonId: string;
    groupId: string;
    groupName: string;
    name: string;
    price: string;
    gstRate: string;
    minSelect: number;
    maxSelect: number;
    isRequired: boolean;
    isAvailable: boolean;
  }[];
}

/** The flattened, POS-ready item list for one outlet: master items with the
 *  outlet's field-level overrides applied, plus the outlet's private items. */
async function resolveEffectiveItems(
  client: PoolClient,
  brandId: string,
  outletId: string,
): Promise<EffectiveItem[]> {
  const { rows } = await client.query<{
    id: string;
    owner_scope: string;
    name: string;
    description: string | null;
    image_url: string | null;
    gst_rate: string;
    price: string;
    is_available: boolean;
    availability_note: string | null;
    offline_sale_allowed: boolean;
    stock_recipe_id: string | null;
    stock_recipe_version: number | null;
    category_name: string | null;
    category_order: number | null;
  }>(
    `with base as (
       select ci.id, ci.owner_scope,
              coalesce(oio.name, ci.name)                 as name,
              coalesce(oio.description, ci.description)   as description,
              coalesce(oio.image_url, ci.image_url)       as image_url,
              coalesce(oio.gst_rate, ci.gst_rate)         as gst_rate,
              coalesce(oio.price, ci.price)               as price,
              coalesce(oio.is_available, ci.is_available) as is_available,
              coalesce(oio.availability_note, ci.availability_note) as availability_note,
              ci.offline_sale_allowed,
              ci.stock_recipe_id, ci.stock_recipe_version,
              coalesce(oio.category_id, ci.category_id)   as category_id
         from billing.catalog_items ci
         left join billing.outlet_item_overrides oio
           on oio.catalog_item_id = ci.id and oio.outlet_id = $2
        where ci.status = 'active'
          and (
            (ci.owner_scope = 'master' and ci.brand_id = $1)
            or (ci.owner_scope = 'outlet' and ci.outlet_id = $2)
          )
     )
     select base.*, c.name as category_name, c.display_order as category_order
       from base
       left join billing.categories c on c.id = base.category_id
      order by category_order nulls last, name`,
    [brandId, outletId],
  );

  const items: EffectiveItem[] = rows.map((r) => ({
    catalogItemId: r.id,
    categoryName: r.category_name ?? 'Menu',
    categoryOrder: r.category_order ?? 0,
    name: r.name,
    description: r.description,
    imageUrl: r.image_url,
    gstRate: r.gst_rate,
    price: r.price,
    isAvailable: r.is_available,
    availabilityNote: r.availability_note,
    offlineSaleAllowed: r.offline_sale_allowed,
    stockRecipeId: r.stock_recipe_id,
    stockRecipeVersion: r.stock_recipe_version,
    addons: [],
  }));

  if (items.length > 0) {
    const addonRows = await client.query<{
      catalog_item_id: string;
      group_id: string;
      group_name: string;
      min_select: number;
      max_select: number;
      is_required: boolean;
      addon_id: string;
      addon_name: string;
      addon_price: string;
      addon_gst: string;
      addon_available: boolean;
    }>(
      `select iag.catalog_item_id,
              g.id as group_id, g.name as group_name, g.min_select, g.max_select, g.is_required,
              a.id as addon_id,
              coalesce(oao.name, a.name)          as addon_name,
              coalesce(oao.price, a.price)        as addon_price,
              a.gst_rate                          as addon_gst,
              coalesce(oao.is_available, a.is_available) as addon_available
         from billing.item_addon_groups iag
         join billing.addon_groups g on g.id = iag.addon_group_id and g.status = 'active'
         join billing.addons a on a.addon_group_id = g.id and a.status = 'active'
         left join billing.outlet_addon_overrides oao
           on oao.addon_id = a.id and oao.outlet_id = $2
        where iag.catalog_item_id = any($1::uuid[])
        order by iag.display_order, a.display_order`,
      [items.map((i) => i.catalogItemId), outletId],
    );
    const byItem = new Map<string, EffectiveItem>(items.map((i) => [i.catalogItemId, i]));
    for (const a of addonRows.rows) {
      byItem.get(a.catalog_item_id)?.addons.push({
        addonId: a.addon_id,
        groupId: a.group_id,
        groupName: a.group_name,
        name: a.addon_name,
        price: a.addon_price,
        gstRate: a.addon_gst,
        minSelect: a.min_select,
        maxSelect: a.max_select,
        isRequired: a.is_required,
        isAvailable: a.addon_available,
      });
    }
  }
  return items;
}

function checksumOf(items: EffectiveItem[]): string {
  const canonical = [...items]
    .sort((a, b) => a.catalogItemId.localeCompare(b.catalogItemId))
    .map((i) => ({
      ...i,
      addons: [...i.addons].sort((x, y) => x.addonId.localeCompare(y.addonId)),
    }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function authorizePublication(
  actor: ActorContext,
  scope: 'master' | 'outlet',
  originOutletId: string | undefined,
): void {
  if (scope === 'outlet') {
    if (!originOutletId) throw new IdentityError('validation', 'originOutletId is required');
    ensureAllowed(actor, 'catalog.menu.manage.franchise', {
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId: originOutletId,
    });
  } else {
    ensureAllowed(actor, 'catalog.menu.publish', { organizationId: actor.scope.organizationId });
  }
}

async function targetOutletIds(
  client: PoolClient,
  cmd: PreviewPublicationCommand,
): Promise<string[]> {
  if (cmd.scope === 'outlet') {
    if (!cmd.originOutletId) throw new IdentityError('validation', 'originOutletId is required');
    return [cmd.originOutletId];
  }
  if (cmd.targetOutletIds && cmd.targetOutletIds.length > 0) {
    const { rows } = await client.query<{ id: string }>(
      `select id from billing.outlets
        where id = any($1::uuid[]) and brand_id = $2 and status <> 'closed'`,
      [cmd.targetOutletIds, cmd.brandId],
    );
    if (rows.length !== cmd.targetOutletIds.length) {
      throw new IdentityError('validation', 'Some target outlets are not on this brand');
    }
    return rows.map((r) => r.id);
  }
  const { rows } = await client.query<{ id: string }>(
    `select id from billing.outlets where brand_id = $1 and status = 'active' order by display_name`,
    [cmd.brandId],
  );
  return rows.map((r) => r.id);
}

export interface PublicationPreview {
  targets: {
    outletId: string;
    currentVersion: string | null;
    willChange: boolean;
    newItemCount: number;
    overridesCleared: number;
  }[];
}

export async function previewPublication(
  pool: Pool,
  actor: ActorContext,
  cmd: PreviewPublicationCommand,
): Promise<PublicationPreview> {
  authorizePublication(actor, cmd.scope, cmd.originOutletId);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outletIds = await targetOutletIds(client, cmd);
    const forcedCols: string[] = cmd.forcedFields
      .map((f) => FORCED_FIELD_COLUMN[f])
      .filter((c): c is string => Boolean(c));
    if (cmd.overwritePrice && !forcedCols.includes('price')) forcedCols.push('price');

    const targets: PublicationPreview['targets'] = [];
    for (const outletId of outletIds) {
      const items = await resolveEffectiveItems(client, cmd.brandId, outletId);
      const sum = checksumOf(items);
      const cur = await client.query<{ version: string; checksum: string }>(
        `select version::text, checksum from billing.outlet_menu_versions
          where outlet_id = $1 and is_current`,
        [outletId],
      );
      let overridesCleared = 0;
      if (forcedCols.length > 0) {
        const c = await client.query<{ n: string }>(
          `select count(*)::int as n from billing.outlet_item_overrides
            where outlet_id = $1 and (${forcedCols.map((col) => `${col} is not null`).join(' or ')})`,
          [outletId],
        );
        overridesCleared = Number(c.rows[0]?.n ?? 0);
      }
      targets.push({
        outletId,
        currentVersion: cur.rows[0]?.version ?? null,
        willChange: cur.rows[0]?.checksum !== sum,
        newItemCount: items.length,
        overridesCleared,
      });
    }
    return { targets };
  });
}

export interface PublicationResult {
  publicationId: string;
  status: 'completed' | 'partly_failed' | 'failed';
  targets: { outletId: string; status: string; version: string | null; error: string | null }[];
}

export async function createAndApplyPublication(
  pool: Pool,
  actor: ActorContext,
  cmd: CreatePublicationCommand,
  meta: RequestMeta = {},
): Promise<PublicationResult> {
  authorizePublication(actor, cmd.scope, cmd.originOutletId);
  const correlationId = meta.correlationId ?? randomUUID();
  const forcedCols: string[] = cmd.forcedFields
    .map((f) => FORCED_FIELD_COLUMN[f])
    .filter((c): c is string => Boolean(c));
  if (cmd.overwritePrice && !forcedCols.includes('price')) forcedCols.push('price');

  // Phase 1: record the publication + targets and clear forced overrides.
  const publicationId = randomUUID();
  const outletIds = await withActorContext(pool, contextForActor(actor), async (client) => {
    const ids = await targetOutletIds(client, cmd);
    if (ids.length === 0) throw new IdentityError('validation', 'No target outlets');

    if (forcedCols.length > 0) {
      await client.query(
        `update billing.outlet_item_overrides
            set ${forcedCols.map((c) => `${c} = null`).join(', ')}, updated_by = $2
          where outlet_id = any($1::uuid[])`,
        [ids, actor.accountId ?? null],
      );
    }

    await client.query(
      `insert into billing.menu_publications
         (id, organization_id, brand_id, initiator_scope, actor_account_id, origin_outlet_id,
          overwrite_price, forced_fields, status, correlation_id, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'applying',$9,$10)`,
      [
        publicationId,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.scope,
        actor.accountId ?? null,
        cmd.scope === 'outlet' ? cmd.originOutletId : null,
        cmd.overwritePrice,
        cmd.forcedFields,
        correlationId,
        cmd.notes ?? null,
      ],
    );
    for (const outletId of ids) {
      await client.query(
        `insert into billing.menu_publication_targets (publication_id, outlet_id, status)
         values ($1,$2,'pending')`,
        [publicationId, outletId],
      );
    }
    await recordAudit(client, {
      action: 'menu.publication_created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(cmd.scope === 'outlet' && cmd.originOutletId ? { outletId: cmd.originOutletId } : {}),
      correlationId,
      metadata: {
        publicationId,
        scope: cmd.scope,
        outletCount: ids.length,
        overwritePrice: cmd.overwritePrice,
        forcedFields: cmd.forcedFields,
      },
    });
    return ids;
  });

  // Phase 2: apply each target in its own transaction.
  for (const outletId of outletIds) {
    await applyOneTarget(pool, actor, publicationId, cmd.brandId, outletId, correlationId);
  }
  return finalizePublication(pool, actor, publicationId);
}

async function applyOneTarget(
  pool: Pool,
  actor: ActorContext,
  publicationId: string,
  brandId: string,
  outletId: string,
  correlationId: string,
): Promise<void> {
  try {
    await withActorContext(pool, contextForActor(actor), async (client) => {
      const t = await client.query<{ id: string; status: string }>(
        `select id, status from billing.menu_publication_targets
          where publication_id = $1 and outlet_id = $2 for update`,
        [publicationId, outletId],
      );
      const target = t.rows[0];
      if (!target) throw new IdentityError('not_found', 'Publication target missing');
      if (target.status === 'succeeded' || target.status === 'skipped') return; // idempotent

      await client.query(
        `update billing.menu_publication_targets
            set status = 'applying', attempts = attempts + 1, error = null
          where id = $1`,
        [target.id],
      );

      const items = await resolveEffectiveItems(client, brandId, outletId);
      const checksum = checksumOf(items);

      const cur = await client.query<{ id: string; checksum: string }>(
        `select id, checksum from billing.outlet_menu_versions where outlet_id = $1 and is_current`,
        [outletId],
      );
      if (cur.rows[0]?.checksum === checksum) {
        await client.query(
          `update billing.menu_publication_targets
              set status = 'skipped', outlet_menu_version_id = $2 where id = $1`,
          [target.id, cur.rows[0].id],
        );
        return;
      }

      const maxV = await client.query<{ next: string }>(
        `select coalesce(max(version), 0) + 1 as next from billing.outlet_menu_versions
          where outlet_id = $1`,
        [outletId],
      );
      const nextVersion = maxV.rows[0]?.next ?? '1';
      const versionId = randomUUID();
      await client.query(
        `insert into billing.outlet_menu_versions
           (id, outlet_id, version, publication_id, item_count, checksum, is_current)
         values ($1,$2,$3,$4,$5,$6,false)`,
        [versionId, outletId, nextVersion, publicationId, items.length, checksum],
      );
      for (const it of items) {
        await client.query(
          `insert into billing.outlet_menu_version_items
             (outlet_menu_version_id, catalog_item_id, category_name, category_order, item_name,
              description, image_url, gst_rate, price, is_available, availability_note, addons,
              stock_recipe_id, stock_recipe_version, offline_sale_allowed)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)`,
          [
            versionId,
            it.catalogItemId,
            it.categoryName,
            it.categoryOrder,
            it.name,
            it.description,
            it.imageUrl,
            it.gstRate,
            it.price,
            it.isAvailable,
            it.availabilityNote,
            JSON.stringify(it.addons),
            it.stockRecipeId,
            it.stockRecipeVersion,
            it.offlineSaleAllowed,
          ],
        );
      }
      await client.query(
        `update billing.outlet_menu_versions set is_current = false
          where outlet_id = $1 and is_current`,
        [outletId],
      );
      await client.query(
        `update billing.outlet_menu_versions set is_current = true where id = $1`,
        [versionId],
      );
      await client.query(
        `update billing.menu_publication_targets
            set status = 'succeeded', outlet_menu_version_id = $2 where id = $1`,
        [target.id, versionId],
      );
      await recordAudit(client, {
        action: 'menu.publication_applied',
        result: 'success',
        actorAccountId: actor.accountId,
        organizationId: actor.scope.organizationId,
        outletId,
        correlationId,
        metadata: { publicationId, version: nextVersion, itemCount: items.length },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await withActorContext(pool, contextForActor(actor), async (client) => {
      await client.query(
        `update billing.menu_publication_targets set status = 'failed', error = $2
          where publication_id = $1 and outlet_id = $3`,
        [publicationId, message.slice(0, 800), outletId],
      );
      await recordAudit(client, {
        action: 'menu.publication_failed',
        result: 'failure',
        actorAccountId: actor.accountId,
        organizationId: actor.scope.organizationId,
        outletId,
        correlationId,
        metadata: { publicationId, error: message.slice(0, 300) },
      });
    });
  }
}

async function finalizePublication(
  pool: Pool,
  actor: ActorContext,
  publicationId: string,
): Promise<PublicationResult> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      outlet_id: string;
      status: string;
      error: string | null;
      version: string | null;
    }>(
      `select t.outlet_id, t.status, t.error, v.version::text as version
         from billing.menu_publication_targets t
         left join billing.outlet_menu_versions v on v.id = t.outlet_menu_version_id
        where t.publication_id = $1
        order by t.outlet_id`,
      [publicationId],
    );
    const ok = rows.filter((r) => r.status === 'succeeded' || r.status === 'skipped').length;
    const failed = rows.filter((r) => r.status === 'failed').length;
    const status: PublicationResult['status'] =
      failed === 0 ? 'completed' : ok === 0 ? 'failed' : 'partly_failed';
    await client.query(
      `update billing.menu_publications
          set status = $2, completed_at = now() where id = $1`,
      [publicationId, status],
    );
    return {
      publicationId,
      status,
      targets: rows.map((r) => ({
        outletId: r.outlet_id,
        status: r.status,
        version: r.version,
        error: r.error,
      })),
    };
  });
}

export async function retryFailedTargets(
  pool: Pool,
  actor: ActorContext,
  publicationId: string,
  meta: RequestMeta = {},
): Promise<PublicationResult> {
  const correlationId = meta.correlationId ?? randomUUID();
  const { brandId, scope, originOutletId, outletIds } = await withActorContext(
    pool,
    contextForActor(actor),
    async (client) => {
      const p = await client.query<{
        brand_id: string;
        initiator_scope: 'master' | 'outlet';
        origin_outlet_id: string | null;
      }>(
        `select brand_id, initiator_scope, origin_outlet_id from billing.menu_publications where id = $1`,
        [publicationId],
      );
      if (!p.rows[0]) throw new IdentityError('not_found', 'Publication not found');
      const t = await client.query<{ outlet_id: string }>(
        `select outlet_id from billing.menu_publication_targets
          where publication_id = $1 and status in ('failed','pending','applying')`,
        [publicationId],
      );
      return {
        brandId: p.rows[0].brand_id,
        scope: p.rows[0].initiator_scope,
        originOutletId: p.rows[0].origin_outlet_id ?? undefined,
        outletIds: t.rows.map((r) => r.outlet_id),
      };
    },
  );
  authorizePublication(actor, scope, originOutletId);

  await withActorContext(pool, contextForActor(actor), (client) =>
    client.query(`update billing.menu_publications set status = 'applying' where id = $1`, [
      publicationId,
    ]),
  );
  for (const outletId of outletIds) {
    await applyOneTarget(pool, actor, publicationId, brandId, outletId, correlationId);
  }
  return finalizePublication(pool, actor, publicationId);
}

export async function getPublication(
  pool: Pool,
  actor: ActorContext,
  publicationId: string,
): Promise<PublicationResult & { createdAt: string }> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const p = await client.query<{ status: PublicationResult['status']; created_at: Date }>(
      `select status, created_at from billing.menu_publications where id = $1`,
      [publicationId],
    );
    if (!p.rows[0]) throw new IdentityError('not_found', 'Publication not found');
    const { rows } = await client.query<{
      outlet_id: string;
      status: string;
      error: string | null;
      version: string | null;
    }>(
      `select t.outlet_id, t.status, t.error, v.version::text as version
         from billing.menu_publication_targets t
         left join billing.outlet_menu_versions v on v.id = t.outlet_menu_version_id
        where t.publication_id = $1 order by t.outlet_id`,
      [publicationId],
    );
    return {
      publicationId,
      status: p.rows[0].status,
      createdAt: p.rows[0].created_at.toISOString(),
      targets: rows.map((r) => ({
        outletId: r.outlet_id,
        status: r.status,
        version: r.version,
        error: r.error,
      })),
    };
  });
}

export async function getPublishedMenu(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
  version?: string,
): Promise<PosMenuSnapshot | null> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const v = await client.query<{
      id: string;
      version: string;
      checksum: string;
      item_count: number;
      created_at: Date;
    }>(
      version
        ? `select id, version::text, checksum, item_count, created_at
             from billing.outlet_menu_versions where outlet_id = $1 and version = $2`
        : `select id, version::text, checksum, item_count, created_at
             from billing.outlet_menu_versions where outlet_id = $1 and is_current`,
      version ? [outletId, version] : [outletId],
    );
    if (!v.rows[0]) return null;
    const items = await client.query<{
      catalog_item_id: string;
      category_name: string;
      category_order: number;
      item_name: string;
      description: string | null;
      image_url: string | null;
      gst_rate: string;
      price: string;
      is_available: boolean;
      availability_note: string | null;
      offline_sale_allowed: boolean;
      stock_recipe_id: string | null;
      stock_recipe_version: number | null;
      addons: unknown;
    }>(
      `select catalog_item_id, category_name, category_order, item_name, description, image_url,
              gst_rate, price, is_available, availability_note, offline_sale_allowed,
              stock_recipe_id, stock_recipe_version, addons
         from billing.outlet_menu_version_items where outlet_menu_version_id = $1
        order by category_order, item_name`,
      [v.rows[0].id],
    );
    return {
      outletId,
      version: v.rows[0].version,
      checksum: v.rows[0].checksum,
      itemCount: v.rows[0].item_count,
      publishedAt: v.rows[0].created_at.toISOString(),
      items: items.rows.map((r) => ({
        catalogItemId: r.catalog_item_id,
        categoryName: r.category_name,
        categoryOrder: r.category_order,
        name: r.item_name,
        description: r.description,
        imageUrl: r.image_url,
        gstRate: r.gst_rate,
        price: r.price,
        isAvailable: r.is_available,
        availabilityNote: r.availability_note,
        offlineSaleAllowed: r.offline_sale_allowed,
        stockRecipeId: r.stock_recipe_id,
        stockRecipeVersion: r.stock_recipe_version,
        addons: (r.addons as PosMenuSnapshot['items'][number]['addons'] | null) ?? [],
      })),
    };
  });
}

export async function copyOutletItemToMaster(
  pool: Pool,
  actor: ActorContext,
  cmd: CopyOutletItemToMasterCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  ensureAllowed(actor, 'catalog.menu.manage.master', {
    organizationId: actor.scope.organizationId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const src = await client.query<{
      id: string;
      owner_scope: string;
      name: string;
      description: string | null;
      image_url: string | null;
      gst_rate: string;
      price: string;
      organization_id: string;
    }>(
      `select id, owner_scope, name, description, image_url, gst_rate, price, organization_id
          from billing.catalog_items where id = $1`,
      [cmd.outletItemId],
    );
    if (src.rows[0]?.owner_scope !== 'outlet') {
      throw new IdentityError('not_found', 'Outlet item not found');
    }
    if (src.rows[0].organization_id !== actor.scope.organizationId) {
      throw new IdentityError('forbidden', 'Item is outside your organization');
    }
    const brand = await client.query<{ organization_id: string }>(
      `select organization_id from billing.brands where id = $1`,
      [cmd.brandId],
    );
    if (brand.rows[0]?.organization_id !== actor.scope.organizationId) {
      throw new IdentityError('validation', 'Brand is outside your organization');
    }
    const id = randomUUID();
    await client.query(
      `insert into billing.catalog_items
         (id, organization_id, brand_id, owner_scope, category_id, name, description, image_url,
          gst_rate, price, status, source_outlet_item_id, promoted_by, created_by)
       values ($1,$2,$3,'master',$4,$5,$6,$7,$8,$9,'draft',$10,$11,$11)`,
      [
        id,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.categoryId ?? null,
        cmd.name ?? src.rows[0].name,
        src.rows[0].description,
        src.rows[0].image_url,
        cmd.gstRate ?? src.rows[0].gst_rate,
        cmd.price ?? src.rows[0].price,
        cmd.outletItemId,
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'catalog.item_promoted',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { masterItemId: id, sourceOutletItemId: cmd.outletItemId },
    });
    return { id };
  });
}
