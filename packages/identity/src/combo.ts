import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool } from '@jksh/db';
import type { ActorContext, CreateComboCommand, UpdateComboCommand } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';
import { assertCatalogWrite, assertBrandInOrg } from './catalog';

/** A combo references existing component items instead of owning a duplicate
 *  recipe (`menu-publishing.md`). Components must be real, currently
 *  visible catalog items - checked here, not just left to an FK, so a
 *  cross-brand or invisible item produces a clear validation error rather
 *  than a silent RLS-filtered mismatch. */
export async function createCombo(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateComboCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  assertCatalogWrite(actor, cmd.outletId);
  const itemIds = [...new Set(cmd.components.map((c) => c.catalogItemId))];
  if (itemIds.length !== cmd.components.length) {
    throw new IdentityError('validation', 'A combo cannot list the same item twice');
  }
  return withActorContext(pool, contextForActor(actor), async (client) => {
    await assertBrandInOrg(client, cmd.brandId, actor.scope.organizationId);
    const items = await client.query<{ id: string }>(
      `select id from billing.catalog_items where id = any($1::uuid[]) and brand_id = $2`,
      [itemIds, cmd.brandId],
    );
    if (items.rows.length !== itemIds.length) {
      throw new IdentityError('validation', 'Every combo component must be an item on this brand');
    }
    const id = randomUUID();
    await client.query(
      `insert into billing.combos
         (id, organization_id, brand_id, owner_scope, outlet_id, name, description, image_url,
          price, is_available, offline_sale_allowed, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.outletId ? 'outlet' : 'master',
        cmd.outletId ?? null,
        cmd.name,
        cmd.description ?? null,
        cmd.imageUrl ?? null,
        cmd.price,
        cmd.isAvailable,
        cmd.offlineSaleAllowed,
        actor.accountId ?? null,
      ],
    );
    for (const [i, c] of cmd.components.entries()) {
      await client.query(
        `insert into billing.combo_components (id, combo_id, catalog_item_id, quantity, display_order)
         values ($1,$2,$3,$4,$5)`,
        [randomUUID(), id, c.catalogItemId, c.quantity, i],
      );
    }
    await recordAudit(client, {
      action: 'catalog.item_created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(cmd.outletId ? { outletId: cmd.outletId } : {}),
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { comboId: id, scope: cmd.outletId ? 'outlet' : 'master', name: cmd.name },
    });
    return { id };
  });
}

export async function updateCombo(
  pool: Pool,
  actor: ActorContext,
  comboId: string,
  cmd: UpdateComboCommand,
  meta: RequestMeta = {},
): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      owner_scope: string;
      outlet_id: string | null;
      brand_id: string;
    }>(`select owner_scope, outlet_id, brand_id from billing.combos where id = $1 for update`, [
      comboId,
    ]);
    const combo = rows[0];
    if (!combo) throw new IdentityError('not_found', 'Combo not found');
    assertCatalogWrite(actor, combo.outlet_id ?? undefined);

    const sets: string[] = [];
    const values: unknown[] = [comboId];
    const put = (col: string, val: unknown): void => {
      values.push(val);
      sets.push(`${col} = $${String(values.length)}`);
    };
    if (cmd.name !== undefined) put('name', cmd.name);
    if (cmd.description !== undefined) put('description', cmd.description ?? null);
    if (cmd.imageUrl !== undefined) put('image_url', cmd.imageUrl ?? null);
    if (cmd.price !== undefined) put('price', cmd.price);
    if (cmd.isAvailable !== undefined) put('is_available', cmd.isAvailable);
    if (cmd.offlineSaleAllowed !== undefined) put('offline_sale_allowed', cmd.offlineSaleAllowed);
    if (sets.length > 0) {
      await client.query(`update billing.combos set ${sets.join(', ')} where id = $1`, values);
    }

    if (cmd.components !== undefined) {
      const itemIds = [...new Set(cmd.components.map((c) => c.catalogItemId))];
      if (itemIds.length !== cmd.components.length) {
        throw new IdentityError('validation', 'A combo cannot list the same item twice');
      }
      const items = await client.query<{ id: string }>(
        `select id from billing.catalog_items where id = any($1::uuid[]) and brand_id = $2`,
        [itemIds, combo.brand_id],
      );
      if (items.rows.length !== itemIds.length) {
        throw new IdentityError(
          'validation',
          'Every combo component must be an item on this brand',
        );
      }
      await client.query(`delete from billing.combo_components where combo_id = $1`, [comboId]);
      for (const [i, c] of cmd.components.entries()) {
        await client.query(
          `insert into billing.combo_components (id, combo_id, catalog_item_id, quantity, display_order)
           values ($1,$2,$3,$4,$5)`,
          [randomUUID(), comboId, c.catalogItemId, c.quantity, i],
        );
      }
    }

    await recordAudit(client, {
      action: 'catalog.item_updated',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      ...(combo.outlet_id ? { outletId: combo.outlet_id } : {}),
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { comboId, fields: Object.keys(cmd) },
    });
  });
}
