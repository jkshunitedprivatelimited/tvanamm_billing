import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  CreateAddonGroupCommand,
  CreateCategoryCommand,
  CreateCatalogItemCommand,
  UpdateCatalogItemCommand,
  UpsertOutletItemOverrideCommand,
  PauseOutletItemCommand,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

/** Central manages master rows; a Franchise Owner manages private outlet rows. */
export function assertCatalogWrite(actor: ActorContext, outletId: string | undefined): void {
  if (outletId) {
    ensureAllowed(actor, 'catalog.menu.manage.franchise', {
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId,
    });
  } else {
    ensureAllowed(actor, 'catalog.menu.manage.master', {
      organizationId: actor.scope.organizationId,
    });
  }
}

export async function assertBrandInOrg(
  client: PoolClient,
  brandId: string,
  orgId: string,
): Promise<void> {
  const { rows } = await client.query<{ organization_id: string }>(
    `select organization_id from billing.brands where id = $1`,
    [brandId],
  );
  if (rows[0]?.organization_id !== orgId) {
    throw new IdentityError('validation', 'Brand is outside your organization');
  }
}

export async function createCategory(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateCategoryCommand,
): Promise<{ id: string }> {
  assertCatalogWrite(actor, cmd.outletId);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    await assertBrandInOrg(client, cmd.brandId, actor.scope.organizationId);
    const id = randomUUID();
    await client.query(
      `insert into billing.categories
         (id, organization_id, brand_id, owner_scope, outlet_id, name, display_order, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.outletId ? 'outlet' : 'master',
        cmd.outletId ?? null,
        cmd.name,
        cmd.displayOrder,
        actor.accountId ?? null,
      ],
    );
    return { id };
  });
}

export async function createAddonGroup(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateAddonGroupCommand,
): Promise<{ id: string; addonIds: string[] }> {
  assertCatalogWrite(actor, cmd.outletId);
  if (cmd.maxSelect < cmd.minSelect) {
    throw new IdentityError('validation', 'maxSelect must be >= minSelect');
  }
  return withActorContext(pool, contextForActor(actor), async (client) => {
    await assertBrandInOrg(client, cmd.brandId, actor.scope.organizationId);
    const id = randomUUID();
    await client.query(
      `insert into billing.addon_groups
         (id, organization_id, brand_id, owner_scope, outlet_id, name, min_select, max_select,
          is_required, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.outletId ? 'outlet' : 'master',
        cmd.outletId ?? null,
        cmd.name,
        cmd.minSelect,
        cmd.maxSelect,
        cmd.isRequired,
        actor.accountId ?? null,
      ],
    );
    const addonIds: string[] = [];
    for (const [i, a] of cmd.addons.entries()) {
      const aid = randomUUID();
      addonIds.push(aid);
      await client.query(
        `insert into billing.addons (id, addon_group_id, name, price, gst_rate, display_order)
         values ($1,$2,$3,$4,$5,$6)`,
        [aid, id, a.name, a.price, a.gstRate, i],
      );
    }
    return { id, addonIds };
  });
}

export async function createCatalogItem(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateCatalogItemCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  assertCatalogWrite(actor, cmd.outletId);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    await assertBrandInOrg(client, cmd.brandId, actor.scope.organizationId);
    // The schema's refine() guarantees exactly one path: a master item sets
    // gstRate/hsnCode directly, an outlet item references a tax profile
    // instead (`menu-publishing.md` "GST/HSN comes from a Central-approved
    // tax profile"). Resolve the profile now so gst_rate/hsn_code stay
    // denormalized on the row for bill-calc/receipts, unchanged elsewhere.
    let hsnCode = cmd.hsnCode ?? null;
    let gstRate = cmd.gstRate;
    if (cmd.outletId) {
      const profile = await client.query<{
        hsn_code: string;
        gst_rate: string;
        is_active: boolean;
      }>(
        `select hsn_code, gst_rate, is_active from billing.tax_profiles
          where id = $1 and brand_id = $2`,
        [cmd.taxProfileId, cmd.brandId],
      );
      if (!profile.rows[0]) throw new IdentityError('not_found', 'Tax profile not found');
      if (!profile.rows[0].is_active) {
        throw new IdentityError('validation', 'That tax profile is no longer active');
      }
      hsnCode = profile.rows[0].hsn_code;
      gstRate = profile.rows[0].gst_rate;
    }
    const id = randomUUID();
    await client.query(
      `insert into billing.catalog_items
         (id, organization_id, brand_id, owner_scope, outlet_id, category_id, name, description,
          image_url, hsn_code, gst_rate, tax_profile_id, price, is_available, offline_sale_allowed,
          created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.outletId ? 'outlet' : 'master',
        cmd.outletId ?? null,
        cmd.categoryId ?? null,
        cmd.name,
        cmd.description ?? null,
        cmd.imageUrl ?? null,
        hsnCode,
        gstRate,
        cmd.taxProfileId ?? null,
        cmd.price,
        cmd.isAvailable,
        cmd.offlineSaleAllowed,
        actor.accountId ?? null,
      ],
    );
    for (const [i, gid] of cmd.addonGroupIds.entries()) {
      await client.query(
        `insert into billing.item_addon_groups (catalog_item_id, addon_group_id, display_order)
         values ($1,$2,$3) on conflict do nothing`,
        [id, gid, i],
      );
    }
    await recordAudit(client, {
      action: 'catalog.item_created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(cmd.outletId ? { outletId: cmd.outletId } : {}),
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { itemId: id, scope: cmd.outletId ? 'outlet' : 'master', name: cmd.name },
    });
    return { id };
  });
}

export async function updateCatalogItem(
  pool: Pool,
  actor: ActorContext,
  itemId: string,
  cmd: UpdateCatalogItemCommand,
  meta: RequestMeta = {},
): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      owner_scope: string;
      outlet_id: string | null;
      brand_id: string;
      price: string;
      gst_rate: string;
    }>(
      `select owner_scope, outlet_id, brand_id, price, gst_rate from billing.catalog_items where id = $1 for update`,
      [itemId],
    );
    const item = rows[0];
    if (!item) throw new IdentityError('not_found', 'Item not found');
    assertCatalogWrite(actor, item.outlet_id ?? undefined);

    if (item.outlet_id && cmd.gstRate !== undefined) {
      throw new IdentityError(
        'validation',
        'This outlet item must reference a taxProfileId instead of setting gstRate directly',
      );
    }
    if (!item.outlet_id && cmd.taxProfileId !== undefined) {
      throw new IdentityError(
        'validation',
        'A master item sets gstRate directly, not a tax profile',
      );
    }

    const sets: string[] = [];
    const values: unknown[] = [itemId];
    const put = (col: string, val: unknown): void => {
      values.push(val);
      sets.push(`${col} = $${String(values.length)}`);
    };
    if (cmd.name !== undefined) put('name', cmd.name);
    if (cmd.description !== undefined) put('description', cmd.description ?? null);
    if (cmd.imageUrl !== undefined) put('image_url', cmd.imageUrl ?? null);
    if (cmd.categoryId !== undefined) put('category_id', cmd.categoryId ?? null);
    let effectiveGstRate = cmd.gstRate;
    if (cmd.taxProfileId !== undefined) {
      const profile = await client.query<{
        hsn_code: string;
        gst_rate: string;
        is_active: boolean;
      }>(
        `select hsn_code, gst_rate, is_active from billing.tax_profiles
          where id = $1 and brand_id = $2`,
        [cmd.taxProfileId, item.brand_id],
      );
      if (!profile.rows[0]) throw new IdentityError('not_found', 'Tax profile not found');
      if (!profile.rows[0].is_active) {
        throw new IdentityError('validation', 'That tax profile is no longer active');
      }
      put('hsn_code', profile.rows[0].hsn_code);
      put('gst_rate', profile.rows[0].gst_rate);
      put('tax_profile_id', cmd.taxProfileId);
      effectiveGstRate = profile.rows[0].gst_rate;
    } else if (cmd.hsnCode !== undefined) {
      put('hsn_code', cmd.hsnCode ?? null);
    }
    if (cmd.gstRate !== undefined) put('gst_rate', cmd.gstRate);
    if (cmd.price !== undefined) put('price', cmd.price);
    if (cmd.isAvailable !== undefined) put('is_available', cmd.isAvailable);
    if (cmd.offlineSaleAllowed !== undefined) put('offline_sale_allowed', cmd.offlineSaleAllowed);
    if (sets.length === 0) return;

    await client.query(`update billing.catalog_items set ${sets.join(', ')} where id = $1`, values);

    const priceChanged = cmd.price !== undefined && cmd.price !== item.price;
    const gstChanged = effectiveGstRate !== undefined && effectiveGstRate !== item.gst_rate;
    if (priceChanged || gstChanged) {
      await client.query(
        `insert into billing.catalog_price_history
           (scope, catalog_item_id, old_price, new_price, old_gst_rate, new_gst_rate, changed_by)
         values ('master_item',$1,$2,$3,$4,$5,$6)`,
        [
          itemId,
          item.price,
          cmd.price ?? item.price,
          item.gst_rate,
          effectiveGstRate ?? item.gst_rate,
          actor.accountId ?? null,
        ],
      );
    }
    await recordAudit(client, {
      action: 'catalog.item_updated',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(item.outlet_id ? { outletId: item.outlet_id } : {}),
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { itemId, fields: Object.keys(cmd), priceChanged, gstChanged },
    });
  });
}

export async function upsertOutletItemOverride(
  pool: Pool,
  actor: ActorContext,
  cmd: UpsertOutletItemOverrideCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  ensureAllowed(actor, 'catalog.price.configure.outlet', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId: cmd.outletId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const item = await client.query<{ id: string; owner_scope: string; price: string }>(
      `select id, owner_scope, price from billing.catalog_items where id = $1`,
      [cmd.catalogItemId],
    );
    if (!item.rows[0]) throw new IdentityError('not_found', 'Item not found');
    if (item.rows[0].owner_scope !== 'master') {
      throw new IdentityError('validation', 'Overrides apply only to master items');
    }
    // Outlet must be visible under RLS (own outlet / Central).
    const outlet = await client.query(`select 1 from billing.outlets where id = $1`, [
      cmd.outletId,
    ]);
    if (outlet.rowCount === 0) throw new IdentityError('not_found', 'Outlet not found');

    const existing = await client.query<{ id: string; price: string | null }>(
      `select id, price from billing.outlet_item_overrides
        where outlet_id = $1 and catalog_item_id = $2 for update`,
      [cmd.outletId, cmd.catalogItemId],
    );

    // (snake column, provided value) for every field the command actually set.
    const fields: [string, unknown][] = [];
    if (cmd.name !== undefined) fields.push(['name', cmd.name]);
    if (cmd.description !== undefined) fields.push(['description', cmd.description]);
    if (cmd.imageUrl !== undefined) fields.push(['image_url', cmd.imageUrl]);
    if (cmd.categoryId !== undefined) fields.push(['category_id', cmd.categoryId]);
    if (cmd.price !== undefined) fields.push(['price', cmd.price]);
    if (cmd.gstRate !== undefined) fields.push(['gst_rate', cmd.gstRate]);
    if (cmd.isAvailable !== undefined) fields.push(['is_available', cmd.isAvailable]);
    if (cmd.availabilityNote !== undefined)
      fields.push(['availability_note', cmd.availabilityNote]);

    let id: string;
    if (existing.rows[0]) {
      id = existing.rows[0].id;
      const params: unknown[] = [id];
      const sets = fields.map(([col, val]) => {
        params.push(val);
        return `${col} = $${String(params.length)}`;
      });
      params.push(actor.accountId ?? null);
      sets.push(`updated_by = $${String(params.length)}`);
      await client.query(
        `update billing.outlet_item_overrides set ${sets.join(', ')} where id = $1`,
        params,
      );
    } else {
      id = randomUUID();
      const col = (c: string): unknown => fields.find(([k]) => k === c)?.[1] ?? null;
      await client.query(
        `insert into billing.outlet_item_overrides
           (id, outlet_id, catalog_item_id, name, description, image_url, category_id, price,
            gst_rate, is_available, availability_note, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          cmd.outletId,
          cmd.catalogItemId,
          col('name'),
          col('description'),
          col('image_url'),
          col('category_id'),
          col('price'),
          col('gst_rate'),
          col('is_available'),
          col('availability_note'),
          actor.accountId ?? null,
        ],
      );
    }

    if (
      cmd.price !== undefined &&
      cmd.price !== null &&
      cmd.price !== (existing.rows[0]?.price ?? null)
    ) {
      await client.query(
        `insert into billing.catalog_price_history
           (scope, catalog_item_id, outlet_id, old_price, new_price, changed_by)
         values ('outlet_item',$1,$2,$3,$4,$5)`,
        [
          cmd.catalogItemId,
          cmd.outletId,
          existing.rows[0]?.price ?? null,
          cmd.price,
          actor.accountId ?? null,
        ],
      );
    }
    await recordAudit(client, {
      action: 'catalog.item_override_set',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { itemId: cmd.catalogItemId, fields: definedKeys(cmd) },
    });
    return { id };
  });
}

/**
 * The one catalog write a Store Employee may make: pause/unpause an item for
 * sale at their own active outlet, without touching name, price, or GST
 * (`menu-publishing.md` "Employee active-outlet pause"). A Franchise Owner
 * pauses within an owned outlet; Central pauses any outlet.
 */
export async function pauseOutletItem(
  pool: Pool,
  actor: ActorContext,
  cmd: PauseOutletItemCommand,
  meta: RequestMeta = {},
): Promise<void> {
  if (actor.kind === 'operator' && actor.outletId !== cmd.outletId) {
    throw new IdentityError(
      'forbidden',
      'Store Employees may only pause items at their own outlet',
    );
  }
  ensureAllowed(actor, 'catalog.item.pause', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId: cmd.outletId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    // Plain read: a master item is visible to any actor under
    // `catalog_items_read`, but the row-security write policy (which a lock
    // would also gate) is narrower and would hide it from a Store Employee.
    // No lock is needed here - the branch below only ever writes when
    // owner_scope = 'outlet', a case the write policy already allows.
    const item = await client.query<{ owner_scope: string; outlet_id: string | null }>(
      `select owner_scope, outlet_id from billing.catalog_items where id = $1`,
      [cmd.catalogItemId],
    );
    if (!item.rows[0]) throw new IdentityError('not_found', 'Item not found');
    const { owner_scope: ownerScope, outlet_id: itemOutletId } = item.rows[0];

    if (ownerScope === 'outlet') {
      if (itemOutletId !== cmd.outletId) {
        throw new IdentityError('validation', 'Item belongs to a different outlet');
      }
      await client.query(
        `update billing.catalog_items set is_available = $2, availability_note = $3 where id = $1`,
        [cmd.catalogItemId, cmd.isAvailable, cmd.availabilityNote ?? null],
      );
    } else {
      const outlet = await client.query(`select 1 from billing.outlets where id = $1`, [
        cmd.outletId,
      ]);
      if (outlet.rowCount === 0) throw new IdentityError('not_found', 'Outlet not found');
      const existing = await client.query<{ id: string }>(
        `select id from billing.outlet_item_overrides
          where outlet_id = $1 and catalog_item_id = $2 for update`,
        [cmd.outletId, cmd.catalogItemId],
      );
      if (existing.rows[0]) {
        await client.query(
          `update billing.outlet_item_overrides
              set is_available = $2, availability_note = $3, updated_by = $4
            where id = $1`,
          [
            existing.rows[0].id,
            cmd.isAvailable,
            cmd.availabilityNote ?? null,
            actor.accountId ?? null,
          ],
        );
      } else {
        await client.query(
          `insert into billing.outlet_item_overrides
             (id, outlet_id, catalog_item_id, is_available, availability_note, updated_by)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            cmd.outletId,
            cmd.catalogItemId,
            cmd.isAvailable,
            cmd.availabilityNote ?? null,
            actor.accountId ?? null,
          ],
        );
      }
    }

    await recordAudit(client, {
      action: 'catalog.item_paused',
      result: 'success',
      actorAccountId: actor.accountId,
      actorEmployeeId: actor.employeeId,
      organizationId: actor.scope.organizationId,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { itemId: cmd.catalogItemId, isAvailable: cmd.isAvailable },
    });
  });
}

function definedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).filter(
    (k) => o[k] !== undefined && k !== 'outletId' && k !== 'catalogItemId',
  );
}

// ---- Read models for the editor -----------------------------------------

export interface MasterMenuView {
  categories: { id: string; name: string; displayOrder: number }[];
  items: {
    id: string;
    name: string;
    categoryId: string | null;
    price: string;
    gstRate: string;
    isAvailable: boolean;
    addonGroupIds: string[];
  }[];
  addonGroups: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    isRequired: boolean;
    addons: { id: string; name: string; price: string; gstRate: string }[];
  }[];
}

export async function listMasterMenu(
  pool: Pool,
  actor: ActorContext,
  brandId: string,
): Promise<MasterMenuView> {
  ensureAllowed(actor, 'catalog.menu.manage.master', {
    organizationId: actor.scope.organizationId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const cats = await client.query<{ id: string; name: string; display_order: number }>(
      `select id, name, display_order from billing.categories
        where brand_id = $1 and owner_scope = 'master' and status <> 'archived'
        order by display_order, name`,
      [brandId],
    );
    const items = await client.query<{
      id: string;
      name: string;
      category_id: string | null;
      price: string;
      gst_rate: string;
      is_available: boolean;
    }>(
      `select id, name, category_id, price, gst_rate, is_available from billing.catalog_items
        where brand_id = $1 and owner_scope = 'master' and status <> 'archived'
        order by name`,
      [brandId],
    );
    const links = await client.query<{ catalog_item_id: string; addon_group_id: string }>(
      `select catalog_item_id, addon_group_id from billing.item_addon_groups
        where catalog_item_id = any($1::uuid[])`,
      [items.rows.map((r) => r.id)],
    );
    const groups = await client.query<{
      id: string;
      name: string;
      min_select: number;
      max_select: number;
      is_required: boolean;
    }>(
      `select id, name, min_select, max_select, is_required from billing.addon_groups
        where brand_id = $1 and owner_scope = 'master' and status <> 'archived' order by name`,
      [brandId],
    );
    const addons = await client.query<{
      id: string;
      addon_group_id: string;
      name: string;
      price: string;
      gst_rate: string;
    }>(
      `select id, addon_group_id, name, price, gst_rate from billing.addons
        where addon_group_id = any($1::uuid[]) and status <> 'archived' order by display_order`,
      [groups.rows.map((r) => r.id)],
    );
    return {
      categories: cats.rows.map((r) => ({
        id: r.id,
        name: r.name,
        displayOrder: r.display_order,
      })),
      items: items.rows.map((r) => ({
        id: r.id,
        name: r.name,
        categoryId: r.category_id,
        price: r.price,
        gstRate: r.gst_rate,
        isAvailable: r.is_available,
        addonGroupIds: links.rows
          .filter((l) => l.catalog_item_id === r.id)
          .map((l) => l.addon_group_id),
      })),
      addonGroups: groups.rows.map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        isRequired: g.is_required,
        addons: addons.rows
          .filter((a) => a.addon_group_id === g.id)
          .map((a) => ({ id: a.id, name: a.name, price: a.price, gstRate: a.gst_rate })),
      })),
    };
  });
}
