import { randomUUID } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';
import { withActorContext, type Pool } from '@jksh/db';
import type { ActorContext, CreateInvitationCommand } from '@jksh/contracts';
import { contextForActor, systemContext } from './db-context';
import { ensureAllowed } from './authz';
import { hashInvitationToken, mintInvitationToken } from './tokens';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

const INVITE_TTL_HOURS = 72;

/**
 * Central Admin pre-creates the Franchise Owner account (status `invited`) plus
 * its franchise membership, then issues a single-use invitation. The owner
 * accepts by verifying the registered mobile via OTP; first OTP login also
 * activates the account, so acceptance mainly records consent + audit.
 */
export async function createFranchiseOwnerInvitation(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateInvitationCommand,
  meta: RequestMeta = {},
): Promise<{ invitationId: string; token: string; accountId: string }> {
  ensureAllowed(actor, 'identity.account.manage', { organizationId: actor.scope.organizationId });
  const secret = identityTokenSecret();
  const { token, tokenHash } = mintInvitationToken(secret);

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const fr = await client.query<{ organization_id: string }>(
      `select organization_id from billing.franchises where id = $1`,
      [cmd.franchiseId],
    );
    if (fr.rows[0]?.organization_id !== actor.scope.organizationId) {
      throw new IdentityError('validation', 'Franchise is outside your organization');
    }

    const existing = await client.query<{ id: string; status: string; is_internal: boolean }>(
      `select id, status, is_internal from identity.account_profiles where mobile = $1`,
      [cmd.phone],
    );
    const existingRow = existing.rows[0];
    if (existingRow?.is_internal) {
      throw new IdentityError(
        'conflict',
        'That mobile belongs to an internal JKSH account; it cannot become a Franchise Owner',
      );
    }
    let accountId = existingRow?.id;
    if (!accountId) {
      accountId = randomUUID();
      await client.query(
        `insert into identity.account_profiles
           (id, mobile, display_name, email, status, is_internal, created_by)
         values ($1,$2,$3,$4,'invited',false,$5)`,
        [accountId, cmd.phone, cmd.fullName, cmd.email ?? null, actor.accountId ?? null],
      );
    }

    await client.query(
      `insert into identity.memberships
         (account_id, role_key, organization_id, franchise_id, created_by)
       values ($1,'franchise_owner',$2,$3,$4)
       on conflict do nothing`,
      [accountId, actor.scope.organizationId, cmd.franchiseId, actor.accountId ?? null],
    );

    // Supersede any still-open invitation for this account so only one is valid.
    await client.query(
      `update identity.invitations
         set status = 'cancelled', cancelled_at = now()
       where account_id = $1 and status in ('pending','delivered')`,
      [accountId],
    );

    const invitationId = randomUUID();
    await client.query(
      `insert into identity.invitations
         (id, account_id, mobile, token_hash, status, expires_at, created_by)
       values ($1,$2,$3,$4,'pending',$5,$6)`,
      [
        invitationId,
        accountId,
        cmd.phone,
        tokenHash,
        new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000),
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'invitation.created',
      result: 'success',
      actorAccountId: actor.accountId,
      subjectId: accountId,
      organizationId: actor.scope.organizationId,
      franchiseId: cmd.franchiseId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { invitationId },
    });
    return { invitationId, token, accountId };
  });
}

/**
 * Consume a single-use invitation. The caller must have already verified an OTP
 * for `phone`; this checks the token, expiry, and that `phone` is the exact
 * invited mobile, then marks it accepted (replay-safe: status flips off
 * pending/delivered).
 */
export async function acceptInvitation(
  pool: Pool,
  token: string,
  phone: string,
  meta: RequestMeta = {},
): Promise<{ accountId: string }> {
  const secret = identityTokenSecret();
  const tokenHash = hashInvitationToken(secret, token);

  return withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{
      id: string;
      account_id: string;
      mobile: string;
      status: string;
      expires_at: Date;
    }>(
      `select id, account_id, mobile, status, expires_at from identity.invitations
        where token_hash = $1 for update`,
      [tokenHash],
    );
    const inv = rows[0];
    if (!inv || (inv.status !== 'pending' && inv.status !== 'delivered')) {
      throw new IdentityError('invitation_invalid', 'Invitation is not valid');
    }
    if (inv.mobile !== phone) {
      throw new IdentityError('invitation_invalid', 'Invitation was issued to a different mobile');
    }
    if (inv.expires_at.getTime() <= Date.now()) {
      await client.query(`update identity.invitations set status = 'expired' where id = $1`, [
        inv.id,
      ]);
      throw new IdentityError('invitation_expired', 'Invitation has expired');
    }
    await client.query(
      `update identity.invitations set status = 'accepted', accepted_at = now() where id = $1`,
      [inv.id],
    );
    await client.query(
      `update identity.account_profiles
         set status = 'active', activated_at = coalesce(activated_at, now())
       where id = $1 and status = 'invited'`,
      [inv.account_id],
    );
    await recordAudit(client, {
      action: 'invitation.accepted',
      result: 'success',
      subjectId: inv.account_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { invitationId: inv.id },
    });
    return { accountId: inv.account_id };
  });
}
