import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool } from '@jksh/db';
import type {
  ActorContext,
  CreateTaxProfileCommand,
  UpdateTaxProfileCommand,
  TaxProfile,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

function toTaxProfile(r: {
  id: string;
  brand_id: string;
  name: string;
  hsn_code: string;
  gst_rate: string;
  is_active: boolean;
}): TaxProfile {
  return {
    id: r.id,
    brandId: r.brand_id,
    name: r.name,
    hsnCode: r.hsn_code,
    gstRate: r.gst_rate,
    isActive: r.is_active,
  };
}

/** Central alone authors GST/HSN tax profiles
 *  (`menu-publishing.md` "GST/HSN comes from a Central-approved tax profile"). */
export async function createTaxProfile(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateTaxProfileCommand,
  meta: RequestMeta = {},
): Promise<TaxProfile> {
  ensureAllowed(actor, 'catalog.tax_profile.manage', {
    organizationId: actor.scope.organizationId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const brand = await client.query<{ organization_id: string }>(
      `select organization_id from billing.brands where id = $1`,
      [cmd.brandId],
    );
    if (brand.rows[0]?.organization_id !== actor.scope.organizationId) {
      throw new IdentityError('validation', 'Brand is outside your organization');
    }
    const id = randomUUID();
    const { rows } = await client.query<{
      id: string;
      brand_id: string;
      name: string;
      hsn_code: string;
      gst_rate: string;
      is_active: boolean;
    }>(
      `insert into billing.tax_profiles
         (id, organization_id, brand_id, name, hsn_code, gst_rate, created_by)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, brand_id, name, hsn_code, gst_rate, is_active`,
      [
        id,
        actor.scope.organizationId,
        cmd.brandId,
        cmd.name,
        cmd.hsnCode,
        cmd.gstRate,
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'catalog.tax_profile_created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { taxProfileId: id, name: cmd.name, gstRate: cmd.gstRate },
    });
    const created = rows[0];
    if (!created) throw new IdentityError('conflict', 'Tax profile insert did not return a row');
    return toTaxProfile(created);
  });
}

export async function updateTaxProfile(
  pool: Pool,
  actor: ActorContext,
  taxProfileId: string,
  cmd: UpdateTaxProfileCommand,
  meta: RequestMeta = {},
): Promise<TaxProfile> {
  ensureAllowed(actor, 'catalog.tax_profile.manage', {
    organizationId: actor.scope.organizationId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const sets: string[] = [];
    const values: unknown[] = [taxProfileId];
    const put = (col: string, val: unknown): void => {
      values.push(val);
      sets.push(`${col} = $${String(values.length)}`);
    };
    if (cmd.name !== undefined) put('name', cmd.name);
    if (cmd.hsnCode !== undefined) put('hsn_code', cmd.hsnCode);
    if (cmd.gstRate !== undefined) put('gst_rate', cmd.gstRate);
    if (cmd.isActive !== undefined) put('is_active', cmd.isActive);
    if (sets.length === 0) {
      const existing = await client.query<{
        id: string;
        brand_id: string;
        name: string;
        hsn_code: string;
        gst_rate: string;
        is_active: boolean;
      }>(
        `select id, brand_id, name, hsn_code, gst_rate, is_active
           from billing.tax_profiles where id = $1`,
        [taxProfileId],
      );
      if (!existing.rows[0]) throw new IdentityError('not_found', 'Tax profile not found');
      return toTaxProfile(existing.rows[0]);
    }
    const { rows } = await client.query<{
      id: string;
      brand_id: string;
      name: string;
      hsn_code: string;
      gst_rate: string;
      is_active: boolean;
    }>(
      `update billing.tax_profiles set ${sets.join(', ')} where id = $1
       returning id, brand_id, name, hsn_code, gst_rate, is_active`,
      values,
    );
    if (!rows[0]) throw new IdentityError('not_found', 'Tax profile not found');
    await recordAudit(client, {
      action: 'catalog.tax_profile_updated',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { taxProfileId, fields: Object.keys(cmd) },
    });
    return toTaxProfile(rows[0]);
  });
}

/** Any admin actor may read profiles (a Franchise Owner needs the list to
 *  populate the picker when creating an outlet item); only Central may write. */
export async function listTaxProfiles(
  pool: Pool,
  actor: ActorContext,
  brandId: string,
): Promise<TaxProfile[]> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      brand_id: string;
      name: string;
      hsn_code: string;
      gst_rate: string;
      is_active: boolean;
    }>(
      `select id, brand_id, name, hsn_code, gst_rate, is_active
         from billing.tax_profiles where brand_id = $1 order by name`,
      [brandId],
    );
    return rows.map(toTaxProfile);
  });
}
