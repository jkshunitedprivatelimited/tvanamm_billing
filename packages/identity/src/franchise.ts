import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool } from '@jksh/db';
import type { ActorContext, CreateFranchiseCommand, FranchiseSummary } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import { generateActivationCode } from './ids';
import type { RequestMeta } from './admin-auth';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56);
  return `${base || 'franchise'}-${generateActivationCode()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 6)}`;
}

/** Central Admin creates a franchise, then invites its owner. */
export async function createFranchise(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateFranchiseCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  ensureAllowed(actor, 'billing.franchise.manage', { organizationId: actor.scope.organizationId });

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const brand = await client.query<{ organization_id: string }>(
      `select organization_id from billing.brands where id = $1`,
      [cmd.brandId],
    );
    if (brand.rows[0]?.organization_id !== actor.scope.organizationId) {
      throw new IdentityError('validation', 'Brand is outside your organization');
    }
    const id = randomUUID();
    await client.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1, $2, $3, $4, $5)`,
      [id, actor.scope.organizationId, cmd.brandId, cmd.name, slugify(cmd.name)],
    );
    await recordAudit(client, {
      action: 'franchise.created',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      franchiseId: id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { name: cmd.name },
    });
    return { id };
  });
}

export async function listFranchises(pool: Pool, actor: ActorContext): Promise<FranchiseSummary[]> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      brand_id: string;
      brand_name: string;
      status: FranchiseSummary['status'];
      outlet_count: string;
    }>(
      `select f.id, f.name, f.brand_id, b.name as brand_name, f.status,
              (select count(*) from billing.outlets o where o.franchise_id = f.id) as outlet_count
         from billing.franchises f
         join billing.brands b on b.id = f.brand_id
        order by f.name`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      brandId: r.brand_id,
      brandName: r.brand_name,
      status: r.status,
      outletCount: Number(r.outlet_count),
    }));
  });
}
