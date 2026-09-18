import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool } from '@jksh/db';
import {
  createOutletCommandSchema,
  ownerOutletDetailsSchema,
  type ActorContext,
  type OwnerOutletDetails,
  type OutletOnboardingView,
  type CreateFranchiseCommand,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { createFranchiseWithClient } from './franchise';
import { createFranchiseOwnerInvitationWithClient } from './invitations';
import { createOutletWithClient } from './outlet';
import { ensureAllowedAudited } from './authz';
import { FRESH_AUTH_SECONDS } from './authorize';
import { IdentityError } from './errors';
import { recordAudit } from './audit';
import type { RequestMeta } from './admin-auth';

export async function inviteOutletOwner(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateFranchiseCommand & { fullName: string; phone: string },
  meta: RequestMeta = {},
) {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const franchise = await createFranchiseWithClient(client, actor, cmd, meta);
    const invite = await createFranchiseOwnerInvitationWithClient(
      client,
      actor,
      { franchiseId: franchise.id, fullName: cmd.fullName, phone: cmd.phone },
      meta,
    );
    return { franchiseId: franchise.id, token: invite.token };
  });
}
export async function listOutletOnboarding(
  pool: Pool,
  actor: ActorContext,
): Promise<OutletOnboardingView[]> {
  if (!['central_admin', 'franchise_owner'].includes(actor.role))
    throw new IdentityError('forbidden', 'No onboarding access');
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      franchise_id: string;
      name: string;
      phone: string;
      accepted: boolean;
      details: OwnerOutletDetails | null;
      outlet_id: string | null;
      active: boolean;
    }>(
      `select f.id as franchise_id, f.name,
        coalesce((select a.mobile from identity.account_profiles a join identity.memberships m on m.account_id=a.id
          where m.franchise_id=f.id and m.role_key='franchise_owner' order by a.created_at limit 1), '') as phone,
        exists(select 1 from identity.account_profiles a join identity.memberships m on m.account_id=a.id
          where m.franchise_id=f.id and m.role_key='franchise_owner' and a.status='active') as accepted,
        n.details, (select o.id from billing.outlets o where o.franchise_id=f.id order by o.created_at limit 1) as outlet_id,
        exists(select 1 from billing.outlets o where o.franchise_id=f.id and o.status='active') as active
      from billing.franchises f left join identity.outlet_onboarding n on n.franchise_id=f.id
      where f.organization_id=$1 order by f.name`,
      [actor.scope.organizationId],
    );
    return rows.map((r) => ({
      franchiseId: r.franchise_id,
      name: r.name,
      phone: r.phone,
      stage: r.active
        ? 'active'
        : r.outlet_id
          ? 'outlet_created'
          : r.details
            ? 'ready_for_review'
            : r.accepted
              ? 'details_pending'
              : 'invited',
      details: r.details,
      outletId: r.outlet_id,
    }));
  });
}
export async function submitOutletOnboarding(
  pool: Pool,
  actor: ActorContext,
  details: OwnerOutletDetails,
  meta: RequestMeta = {},
): Promise<void> {
  if (
    actor.role !== 'franchise_owner' ||
    !actor.scope.franchiseId ||
    !actor.accountId ||
    !actor.sessionActive
  )
    throw new IdentityError('forbidden', 'An owner workspace is required');
  const safe = ownerOutletDetailsSchema.parse(details);
  const f = actor.scope.franchiseId;
  await withActorContext(pool, contextForActor(actor), async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `onboarding:${f}`,
    ]);
    const existing = await client.query('select id from billing.outlets where franchise_id=$1', [
      f,
    ]);
    if (existing.rowCount) throw new IdentityError('conflict', 'Your outlet is already created');
    const submitted = await client.query(
      'select 1 from identity.outlet_onboarding where franchise_id=$1',
      [f],
    );
    if (submitted.rowCount)
      throw new IdentityError('conflict', 'Your details are already awaiting review');
    await client.query(
      'insert into identity.outlet_onboarding (franchise_id, details, submitted_by) values ($1,$2,$3)',
      [f, JSON.stringify(safe), actor.accountId],
    );
    await recordAudit(client, {
      action: 'outlet.setup_submitted',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      franchiseId: f,
      correlationId: meta.correlationId ?? randomUUID(),
    });
  });
}
export async function approveOutletOnboarding(
  pool: Pool,
  actor: ActorContext,
  franchiseId: string,
  transportChargePaise: number,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  await ensureAllowedAudited(
    pool,
    'outlet.activated',
    actor,
    'billing.outlet.lifecycle',
    { organizationId: actor.scope.organizationId },
    { requireFreshAuthWithinSeconds: FRESH_AUTH_SECONDS },
  );
  if (
    !Number.isSafeInteger(transportChargePaise) ||
    transportChargePaise < 0 ||
    transportChargePaise > 100_000_00
  )
    throw new IdentityError('validation', 'Invalid transport charge');
  return withActorContext(pool, contextForActor(actor), async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `onboarding:${franchiseId}`,
    ]);
    const { rows } = await client.query<{
      details: OwnerOutletDetails;
      outlet_id: string | null;
      brand_id: string;
    }>(
      `select n.details, n.outlet_id, f.brand_id from identity.outlet_onboarding n join billing.franchises f on f.id=n.franchise_id
       where n.franchise_id=$1 and f.organization_id=$2 for update of n`,
      [franchiseId, actor.scope.organizationId],
    );
    const row = rows[0];
    if (!row) throw new IdentityError('not_found', 'No submitted details to review');
    if (row.outlet_id) return { id: row.outlet_id };
    const existing = await client.query('select id from billing.outlets where franchise_id=$1', [
      franchiseId,
    ]);
    if (existing.rowCount)
      throw new IdentityError('conflict', 'An outlet already exists. Review it from All outlets.');
    const cmd = createOutletCommandSchema.parse({
      ...ownerOutletDetailsSchema.parse(row.details),
      brandId: row.brand_id,
      franchiseId,
      ownershipType: 'franchise_owned',
      transportChargePaise,
    });
    const outlet = await createOutletWithClient(client, actor, cmd, meta);
    await client.query(
      "update billing.outlets set status='active', billing_enabled=true where id=$1",
      [outlet.id],
    );
    await client.query(
      'update identity.outlet_onboarding set outlet_id=$2, reviewed_by=$3, reviewed_at=now() where franchise_id=$1',
      [franchiseId, outlet.id, actor.accountId],
    );
    await recordAudit(client, {
      action: 'outlet.activated',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      franchiseId,
      outletId: outlet.id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { source: 'owner_onboarding' },
    });
    return outlet;
  });
}
