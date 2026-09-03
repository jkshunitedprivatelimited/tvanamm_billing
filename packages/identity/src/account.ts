import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool } from '@jksh/db';
import type { AccountStatus, ActorContext } from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowedAudited } from './authz';
import { FRESH_AUTH_SECONDS } from './authorize';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

const TIMESTAMP_COLUMN: Partial<Record<AccountStatus, string>> = {
  active: 'activated_at',
  suspended: 'suspended_at',
  closed: 'closed_at',
};

/**
 * Central Admin disables / reactivates a Franchise Owner or internal account.
 * A non-active status is a hard stop at the next login and this call does not
 * touch Supabase sessions directly; the app calls `auth.admin.signOut` for the
 * affected auth user.
 */
export async function setAccountStatus(
  pool: Pool,
  actor: ActorContext,
  accountId: string,
  status: AccountStatus,
  reason: string | undefined,
  meta: RequestMeta = {},
): Promise<{ authUserId: string | null }> {
  await ensureAllowedAudited(
    pool,
    'account.status_changed',
    actor,
    'identity.account.manage',
    { organizationId: actor.scope.organizationId },
    { requireFreshAuthWithinSeconds: FRESH_AUTH_SECONDS },
  );

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      id: string;
      auth_user_id: string | null;
      status: AccountStatus;
    }>(`select id, auth_user_id, status from identity.account_profiles where id = $1 for update`, [
      accountId,
    ]);
    const row = rows[0];
    if (!row) throw new IdentityError('not_found', 'Account not found');

    const stamp = TIMESTAMP_COLUMN[status];
    await client.query(
      `update identity.account_profiles
         set status = $2 ${stamp ? `, ${stamp} = now()` : ''}
       where id = $1`,
      [accountId, status],
    );
    if (status !== 'active') {
      await client.query(
        `update identity.memberships set status = 'suspended'
         where account_id = $1 and status = 'active'`,
        [accountId],
      );
    } else {
      await client.query(
        `update identity.memberships set status = 'active'
         where account_id = $1 and status = 'suspended'`,
        [accountId],
      );
    }
    await recordAudit(client, {
      action: 'account.status_changed',
      result: 'success',
      actorAccountId: actor.accountId,
      subjectId: accountId,
      organizationId: actor.scope.organizationId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { status, from: row.status, ...(reason ? { reason } : {}) },
    });
    return { authUserId: row.auth_user_id };
  });
}
