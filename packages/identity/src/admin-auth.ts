import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  AccountStatus,
  ActorContext,
  AdminLoginResult,
  MembershipRole,
  WorkspaceCard,
} from '@jksh/contracts';
import { systemContext } from './db-context';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import { resolveAdminRouting, sortWorkspaceCards, type MembershipRow } from './membership';

export interface RequestMeta {
  correlationId?: string;
  userAgent?: string;
  ip?: string;
  deviceLabel?: string;
}

async function loadMembershipRows(client: PoolClient, accountId: string): Promise<MembershipRow[]> {
  const { rows } = await client.query<{
    id: string;
    role_key: MembershipRole;
    status: MembershipRow['status'];
    organization_id: string;
    brand_id: string | null;
    franchise_id: string | null;
  }>(
    `select id, role_key, status, organization_id, brand_id, franchise_id
       from identity.memberships where account_id = $1`,
    [accountId],
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role_key,
    status: r.status,
    organizationId: r.organization_id,
    brandId: r.brand_id,
    franchiseId: r.franchise_id,
  }));
}

/**
 * Post-OTP-verify resolution. Supabase Auth has confirmed the mobile and issued
 * a session; here we link the auth user to `identity.account_profiles` (which
 * Central Admin pre-created as `invited`) and resolve the workspace routing.
 */
export async function resolveAdminAfterVerify(
  pool: Pool,
  input: { authUserId: string; phone: string; displayName?: string },
  meta: RequestMeta = {},
): Promise<{ result: AdminLoginResult; accountId?: string }> {
  const correlationId = meta.correlationId ?? randomUUID();

  return withActorContext(pool, systemContext(), async (client) => {
    const found = await client.query<{ id: string; status: AccountStatus }>(
      `select id, status from identity.account_profiles where mobile = $1 for update`,
      [input.phone],
    );
    let profile = found.rows[0];

    if (!profile) {
      // Public self-registration is disabled. No pre-created account -> rejected.
      await recordAudit(client, {
        action: 'login.failed',
        result: 'denied',
        correlationId,
        metadata: { surface: 'admin', reason: 'no_account' },
      });
      return { result: { outcome: 'rejected' } };
    }

    if (profile.status === 'invited') {
      // First login on an invited account activates it (invitation flow may also
      // do this explicitly). Any non-invited, non-active status is a hard stop.
      await client.query(
        `update identity.account_profiles
           set status = 'active', activated_at = now(), auth_user_id = $2
         where id = $1`,
        [profile.id, input.authUserId],
      );
      profile = { ...profile, status: 'active' };
    } else if (profile.status !== 'active') {
      await recordAudit(client, {
        action: 'disabled_account.access_attempt',
        result: 'denied',
        actorAccountId: profile.id,
        correlationId,
        metadata: { surface: 'admin', status: profile.status },
      });
      return { result: { outcome: 'rejected' } };
    } else {
      await client.query(
        `update identity.account_profiles set auth_user_id = $2
         where id = $1 and auth_user_id is distinct from $2`,
        [profile.id, input.authUserId],
      );
    }

    // Record the interactive OTP verification for fresh-auth checks.
    await client.query(`update identity.account_profiles set last_otp_at = now() where id = $1`, [
      profile.id,
    ]);

    const memberships = await loadMembershipRows(client, profile.id);
    const routing = resolveAdminRouting(memberships);
    if (routing.outcome === 'no_admin_access') {
      await recordAudit(client, {
        action: 'login.failed',
        result: 'denied',
        actorAccountId: profile.id,
        correlationId,
        metadata: { surface: 'admin', reason: 'no_membership' },
      });
      return { result: { outcome: 'rejected' } };
    }

    await recordAudit(client, {
      action: 'login.succeeded',
      result: 'success',
      actorAccountId: profile.id,
      correlationId,
      metadata: { surface: 'admin' },
    });

    if (routing.outcome === 'single_workspace') {
      const picked = memberships.find((m) => m.id === routing.membershipId);
      if (!picked) throw new IdentityError('conflict', 'Resolved membership vanished');
      await recordAudit(client, {
        action: 'workspace.selected',
        result: 'success',
        actorAccountId: profile.id,
        organizationId: picked.organizationId,
        franchiseId: picked.franchiseId,
        correlationId,
        metadata: { membershipId: picked.id, auto: true },
      });
      return {
        result: {
          outcome: 'single_workspace',
          membershipId: routing.membershipId,
          redirectTo: routing.redirectTo,
        },
        accountId: profile.id,
      };
    }

    return { result: { outcome: 'select_workspace' }, accountId: profile.id };
  });
}

/**
 * Is this mobile attached to an account that may receive an OTP? Callers still
 * return the same generic response for eligible and unknown numbers — this only
 * avoids dispatching an SMS (and a provider cost) for a stranger's number.
 * Public self-registration is disabled, so an unknown number is never eligible.
 */
export async function eligibleForOtp(pool: Pool, phone: string): Promise<boolean> {
  return withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{ ok: boolean }>(
      `select exists (
         select 1 from identity.account_profiles
          where mobile = $1 and status in ('invited','active')
       ) as ok`,
      [phone],
    );
    return rows[0]?.ok ?? false;
  });
}

export async function listWorkspaceCards(pool: Pool, authUserId: string): Promise<WorkspaceCard[]> {
  return withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{
      membership_id: string;
      role_key: MembershipRole;
      organization_id: string;
      organization_name: string;
      brand_name: string | null;
      franchise_id: string | null;
      franchise_name: string | null;
    }>(
      `select m.id            as membership_id,
              m.role_key      as role_key,
              o.id            as organization_id,
              o.name          as organization_name,
              b.name          as brand_name,
              f.id            as franchise_id,
              f.name          as franchise_name
         from identity.account_profiles ap
         join identity.memberships m on m.account_id = ap.id and m.status = 'active'
         join billing.organizations o on o.id = m.organization_id
         left join billing.brands b     on b.id = m.brand_id
         left join billing.franchises f on f.id = m.franchise_id
        where ap.auth_user_id = $1`,
      [authUserId],
    );
    const cards: WorkspaceCard[] = rows.map((r) => ({
      membershipId: r.membership_id,
      role: r.role_key,
      organizationId: r.organization_id,
      organizationName: r.organization_name,
      ...(r.brand_name ? { brandName: r.brand_name } : {}),
      ...(r.franchise_id ? { franchiseId: r.franchise_id } : {}),
      ...(r.franchise_name ? { franchiseName: r.franchise_name } : {}),
    }));
    return sortWorkspaceCards(cards);
  });
}

export interface ResolvedWorkspace {
  redirectTo: string;
  membershipId: string;
}

/** Validate a chosen workspace for the authenticated auth user and audit it.
 *  The caller stores `membershipId` in a signed cookie; there is no server row. */
export async function selectWorkspace(
  pool: Pool,
  input: { authUserId: string; membershipId: string },
  meta: RequestMeta = {},
): Promise<ResolvedWorkspace> {
  return withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{
      account_id: string;
      role_key: MembershipRole;
      status: string;
      account_status: AccountStatus;
      organization_id: string;
      franchise_id: string | null;
    }>(
      `select m.account_id, m.role_key, m.status, ap.status as account_status,
              m.organization_id, m.franchise_id
         from identity.memberships m
         join identity.account_profiles ap on ap.id = m.account_id
        where m.id = $1 and ap.auth_user_id = $2`,
      [input.membershipId, input.authUserId],
    );
    const row = rows[0];
    if (row?.status !== 'active' || row.account_status !== 'active') {
      throw new IdentityError('forbidden', 'Workspace is not available');
    }
    await recordAudit(client, {
      action: 'workspace.selected',
      result: 'success',
      actorAccountId: row.account_id,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { membershipId: input.membershipId },
    });
    return {
      membershipId: input.membershipId,
      redirectTo: row.role_key === 'accountant' ? '/reports' : '/',
    };
  });
}

export interface AdminActorInput {
  authUserId: string;
  membershipId: string | null;
  now?: Date;
}

/**
 * Build the authorization context for an authenticated admin request.
 * `secondsSinceAuth` is derived from `account_profiles.last_otp_at` — the moment
 * of the latest interactive OTP verification, which token refresh never moves.
 */
export async function buildAdminActor(
  pool: Pool,
  input: AdminActorInput,
): Promise<ActorContext | null> {
  const now = input.now ?? new Date();
  return withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{
      account_id: string;
      account_status: AccountStatus;
      last_otp_at: Date | null;
      membership_id: string | null;
      role_key: MembershipRole | null;
      membership_status: string | null;
      organization_id: string | null;
      brand_id: string | null;
      franchise_id: string | null;
    }>(
      `select ap.id                 as account_id,
              ap.status             as account_status,
              ap.last_otp_at        as last_otp_at,
              m.id                  as membership_id,
              m.role_key            as role_key,
              m.status              as membership_status,
              m.organization_id     as organization_id,
              m.brand_id            as brand_id,
              m.franchise_id        as franchise_id
         from identity.account_profiles ap
         left join identity.memberships m
                on m.id = $2 and m.account_id = ap.id
        where ap.auth_user_id = $1`,
      [input.authUserId, input.membershipId],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.account_status === 'closed' || row.account_status === 'locked') {
      throw new IdentityError('account_disabled', 'Account is not active');
    }
    if (
      !input.membershipId ||
      !row.membership_id ||
      row.membership_status !== 'active' ||
      !row.role_key ||
      !row.organization_id
    ) {
      return null; // needs (re-)selecting a workspace
    }
    const secondsSinceAuth = row.last_otp_at
      ? Math.max(0, Math.floor((now.getTime() - row.last_otp_at.getTime()) / 1000))
      : undefined;
    return {
      kind: 'admin',
      accountId: row.account_id,
      accountStatus: row.account_status,
      role: row.role_key,
      scope: {
        organizationId: row.organization_id,
        ...(row.brand_id ? { brandId: row.brand_id } : {}),
        ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
      },
      sessionActive: true,
      ...(secondsSinceAuth !== undefined ? { secondsSinceAuth } : {}),
    };
  });
}

export async function recordAdminLogout(
  pool: Pool,
  accountId: string | null,
  all: boolean,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, systemContext(), (client) =>
    recordAudit(client, {
      action: all ? 'logout_all' : 'logout',
      result: 'success',
      actorAccountId: accountId,
      correlationId: meta.correlationId ?? randomUUID(),
    }),
  );
}
