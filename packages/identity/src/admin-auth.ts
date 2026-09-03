import { randomUUID } from 'node:crypto';
import { withTransaction, type Pool, type PoolClient } from '@jksh/db';
import type {
  AdminLoginResult,
  Membership,
  Role,
  StartOtpResult,
  WorkspaceCard,
} from '@jksh/contracts';
import { sortWorkspaceCards, resolveAdminRouting } from './membership.js';
import { mintSessionToken } from './tokens.js';
import { createSession, revokeSession, revokeAllUserSessions } from './session-context.js';
import { recordAudit } from './audit.js';
import { IdentityError } from './errors.js';
import { getOtpProvider } from './otp-provider.js';
import {
  DEFAULT_OTP_POLICY,
  EMPTY_OTP_STATE,
  otpSendGate,
  otpVerifyGate,
  registerOtpSend,
  registerOtpVerifyFailure,
  resetOtpState,
  type OtpAttemptState,
} from './otp.js';

export interface RequestMeta {
  correlationId?: string;
  userAgent?: string;
  ip?: string;
  deviceLabel?: string;
}

export interface AdminLoginOutput {
  result: AdminLoginResult;
  /** Set as an HttpOnly cookie by the caller when present. */
  sessionToken?: string;
}

// --- OTP attempt persistence --------------------------------------------------

async function loadOtpState(
  client: PoolClient,
  phone: string,
): Promise<OtpAttemptState> {
  const { rows } = await client.query<{
    sent_count: number;
    last_sent_at: Date | null;
    verify_failed_count: number;
    last_failed_at: Date | null;
    locked_until: Date | null;
    window_started_at: Date;
  }>(
    `select sent_count, last_sent_at, verify_failed_count, last_failed_at,
            locked_until, window_started_at
       from identity.otp_attempts where phone = $1
       for update`,
    [phone],
  );
  const row = rows[0];
  if (!row) return { ...EMPTY_OTP_STATE, windowStartedAt: new Date() };
  return {
    sentCount: row.sent_count,
    lastSentAt: row.last_sent_at,
    verifyFailedCount: row.verify_failed_count,
    lastFailedAt: row.last_failed_at,
    lockedUntil: row.locked_until,
    windowStartedAt: row.window_started_at,
  };
}

async function saveOtpState(
  client: PoolClient,
  phone: string,
  state: OtpAttemptState,
): Promise<void> {
  await client.query(
    `insert into identity.otp_attempts
       (phone, sent_count, last_sent_at, verify_failed_count, last_failed_at,
        locked_until, window_started_at)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (phone) do update set
       sent_count = excluded.sent_count,
       last_sent_at = excluded.last_sent_at,
       verify_failed_count = excluded.verify_failed_count,
       last_failed_at = excluded.last_failed_at,
       locked_until = excluded.locked_until,
       window_started_at = excluded.window_started_at`,
    [
      phone,
      state.sentCount,
      state.lastSentAt,
      state.verifyFailedCount,
      state.lastFailedAt,
      state.lockedUntil,
      state.windowStartedAt,
    ],
  );
}

// --- Start OTP --------------------------------------------------------------

/**
 * Send a mobile OTP. The response is identical whether or not the number maps to
 * a known account (anti-enumeration). Enforces resend cooldown, per-window send
 * cap, and temporary lock.
 */
export async function startAdminOtp(
  pool: Pool,
  input: { phone: string },
  meta: RequestMeta = {},
): Promise<StartOtpResult> {
  const correlationId = meta.correlationId ?? randomUUID();
  const now = new Date();

  return withTransaction(pool, async (client) => {
    const state = await loadOtpState(client, input.phone);
    const gate = otpSendGate(state, now);
    if (!gate.allowed) {
      await recordAudit(client, {
        action: 'otp.sent',
        result: 'denied',
        correlationId,
        metadata: { throttled: true },
      });
      return { sent: true, resendAvailableInSeconds: gate.retryAfterSeconds };
    }

    const sent = await getOtpProvider().send(input.phone);
    // A provider error is not surfaced to the caller; log it and stay generic.
    const next = registerOtpSend(state, now);
    await saveOtpState(client, input.phone, next);
    await recordAudit(client, {
      action: 'otp.sent',
      result: sent.ok ? 'success' : 'failure',
      correlationId,
      metadata: sent.ok ? {} : { provider_error: true },
    });

    return {
      sent: true,
      resendAvailableInSeconds: DEFAULT_OTP_POLICY.resendCooldownSeconds,
    };
  });
}

// --- Verify OTP -> session -------------------------------------------------

async function loadMemberships(
  client: PoolClient,
  userId: string,
): Promise<Membership[]> {
  const { rows } = await client.query<{
    id: string;
    role: Role;
    status: Membership['status'];
    organization_id: string;
    brand_id: string | null;
    franchise_id: string | null;
    outlet_id: string | null;
  }>(
    `select id, role, status, organization_id, brand_id, franchise_id, outlet_id
       from identity.memberships where user_id = $1`,
    [userId],
  );
  return rows.map((row) => ({
    id: row.id,
    userId,
    role: row.role,
    status: row.status,
    scope: {
      organizationId: row.organization_id,
      ...(row.brand_id ? { brandId: row.brand_id } : {}),
      ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
      ...(row.outlet_id ? { outletId: row.outlet_id } : {}),
    },
  }));
}

export async function verifyAdminOtp(
  pool: Pool,
  input: { phone: string; code: string; deviceLabel?: string },
  meta: RequestMeta = {},
): Promise<AdminLoginOutput> {
  const correlationId = meta.correlationId ?? randomUUID();
  const now = new Date();

  // Gate check in its own short transaction so a provider call is not held open.
  const gate = await withTransaction(pool, async (client) => {
    const state = await loadOtpState(client, input.phone);
    return otpVerifyGate(state, now);
  });
  if (!gate.allowed) {
    return { result: { outcome: 'rejected', retryAfterSeconds: gate.retryAfterSeconds } };
  }

  const verification = await getOtpProvider().verify(input.phone, input.code);

  if (!verification.ok) {
    return withTransaction(pool, async (client) => {
      const state = await loadOtpState(client, input.phone);
      const next = registerOtpVerifyFailure(state, now);
      await saveOtpState(client, input.phone, next);
      await recordAudit(client, {
        action: 'otp.verify_failed',
        result: 'failure',
        correlationId,
        metadata: { failedCount: next.verifyFailedCount },
      });
      await recordAudit(client, {
        action: 'login.failed',
        result: 'failure',
        correlationId,
        metadata: { surface: 'admin', reason: 'otp_invalid' },
      });
      const lockMs = next.lockedUntil?.getTime() ?? 0;
      const retry =
        lockMs > now.getTime() ? Math.ceil((lockMs - now.getTime()) / 1000) : undefined;
      return {
        result: { outcome: 'rejected', ...(retry ? { retryAfterSeconds: retry } : {}) },
      };
    });
  }

  return withTransaction(pool, async (client) => {
    await saveOtpState(client, input.phone, resetOtpState(now));

    const { rows: userRows } = await client.query<{
      id: string;
      account_state: string;
    }>(
      `select id, account_state
         from identity.users
        where has_auth_login and phone = $1
        limit 1
        for update`,
      [input.phone],
    );
    const user = userRows[0];

    if (!user) {
      // Public self-registration is disabled: no account, no session.
      await recordAudit(client, {
        action: 'login.failed',
        result: 'denied',
        correlationId,
        metadata: { surface: 'admin', reason: 'no_account' },
      });
      return { result: { outcome: 'rejected' } };
    }

    if (user.account_state !== 'active') {
      await recordAudit(client, {
        action: user.account_state === 'invited' ? 'login.failed' : 'disabled_account.access_attempt',
        result: 'denied',
        actorUserId: user.id,
        correlationId,
        metadata: {
          surface: 'admin',
          reason: user.account_state === 'invited' ? 'awaiting_invitation_acceptance' : 'account_inactive',
        },
      });
      return { result: { outcome: 'rejected' } };
    }

    const memberships = await loadMemberships(client, user.id);
    const routing = resolveAdminRouting(memberships);
    if (routing.outcome === 'no_admin_access') {
      await recordAudit(client, {
        action: 'login.failed',
        result: 'denied',
        actorUserId: user.id,
        correlationId,
        metadata: { surface: 'admin', reason: 'no_admin_membership' },
      });
      return { result: { outcome: 'rejected' } };
    }

    const session = await createSession(client, {
      userId: user.id,
      kind: 'admin',
      authProviderRef: getOtpProvider().name,
      device: {
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        ...(meta.ip ? { ip: meta.ip } : {}),
        ...(input.deviceLabel ? { label: input.deviceLabel } : {}),
      },
      ip: meta.ip ?? null,
      now,
    });
    const minted = mintSessionToken(session.id);
    await client.query(
      `update identity.sessions set refresh_token_hash = $2 where id = $1`,
      [session.id, minted.tokenHash],
    );
    await recordAudit(client, {
      action: 'login.succeeded',
      result: 'success',
      actorUserId: user.id,
      sessionId: session.id,
      correlationId,
      metadata: { surface: 'admin' },
    });

    if (routing.outcome === 'single_workspace') {
      await client.query(
        `update identity.sessions set membership_id = $2 where id = $1`,
        [session.id, routing.membershipId],
      );
      const picked = memberships.find((m) => m.id === routing.membershipId);
      if (!picked) throw new IdentityError('conflict', 'Resolved membership vanished');
      await recordAudit(client, {
        action: 'workspace.selected',
        result: 'success',
        actorUserId: user.id,
        sessionId: session.id,
        organizationId: picked.scope.organizationId,
        franchiseId: picked.scope.franchiseId ?? null,
        outletId: picked.scope.outletId ?? null,
        correlationId,
        metadata: { membershipId: picked.id, auto: true },
      });
      return {
        result: {
          outcome: 'single_workspace',
          sessionId: session.id,
          membershipId: routing.membershipId,
          redirectTo: routing.redirectTo,
        },
        sessionToken: minted.token,
      };
    }

    return {
      result: { outcome: 'select_workspace', sessionId: session.id },
      sessionToken: minted.token,
    };
  });
}

// --- Workspace selection / logout ----------------------------------------

export async function listWorkspaceCards(
  pool: Pool,
  userId: string,
): Promise<WorkspaceCard[]> {
  const { rows } = await pool.query<{
    membership_id: string;
    role: Role;
    organization_id: string;
    organization_name: string;
    brand_name: string | null;
    franchise_id: string | null;
    franchise_name: string | null;
    outlet_id: string | null;
    outlet_name: string | null;
    outlet_address: string | null;
  }>(
    `select m.id              as membership_id,
            m.role            as role,
            o.id              as organization_id,
            o.name            as organization_name,
            b.name            as brand_name,
            f.id              as franchise_id,
            f.name            as franchise_name,
            ot.id             as outlet_id,
            ot.name           as outlet_name,
            ot.address        as outlet_address
       from identity.memberships m
       join identity.organizations o on o.id = m.organization_id
       left join identity.brands b     on b.id = m.brand_id
       left join identity.franchises f on f.id = m.franchise_id
       left join identity.outlets ot   on ot.id = m.outlet_id
      where m.user_id = $1 and m.status = 'active'`,
    [userId],
  );

  const cards: WorkspaceCard[] = rows.map((row) => ({
    membershipId: row.membership_id,
    role: row.role,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    ...(row.brand_name ? { brandName: row.brand_name } : {}),
    ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
    ...(row.franchise_name ? { franchiseName: row.franchise_name } : {}),
    ...(row.outlet_id ? { outletId: row.outlet_id } : {}),
    ...(row.outlet_name ? { outletName: row.outlet_name } : {}),
    ...(row.outlet_address ? { outletAddress: row.outlet_address } : {}),
  }));
  return sortWorkspaceCards(cards);
}

export async function selectWorkspace(
  pool: Pool,
  sessionId: string,
  membershipId: string,
  meta: RequestMeta = {},
): Promise<{ redirectTo: string }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      user_id: string;
      role: Role;
      status: string;
      session_user: string;
      session_state: string;
      organization_id: string;
      franchise_id: string | null;
      outlet_id: string | null;
    }>(
      `select m.user_id         as user_id,
              m.role            as role,
              m.status          as status,
              s.user_id         as session_user,
              s.state           as session_state,
              m.organization_id as organization_id,
              m.franchise_id    as franchise_id,
              m.outlet_id       as outlet_id
         from identity.sessions s
         join identity.memberships m on m.id = $2
        where s.id = $1`,
      [sessionId, membershipId],
    );
    const row = rows[0];
    if (row?.session_state !== 'active') {
      throw new IdentityError('session_expired', 'Session is not active');
    }
    if (row.user_id !== row.session_user || row.status !== 'active') {
      throw new IdentityError('forbidden', 'Membership is not available');
    }
    await client.query(
      `update identity.sessions set membership_id = $2 where id = $1`,
      [sessionId, membershipId],
    );
    await recordAudit(client, {
      action: 'workspace.selected',
      result: 'success',
      actorUserId: row.user_id,
      sessionId,
      organizationId: row.organization_id,
      franchiseId: row.franchise_id,
      outletId: row.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { membershipId },
    });
    return { redirectTo: row.role === 'accountant' ? '/reports' : '/' };
  });
}

export async function adminLogout(
  pool: Pool,
  sessionId: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ user_id: string }>(
      `select user_id from identity.sessions where id = $1`,
      [sessionId],
    );
    await revokeSession(client, sessionId, 'logout');
    await recordAudit(client, {
      action: 'logout',
      result: 'success',
      actorUserId: rows[0]?.user_id ?? null,
      sessionId,
      correlationId: meta.correlationId ?? randomUUID(),
    });
  });
}

/** Disable an account and end every active session immediately. */
export async function disableUser(
  pool: Pool,
  actorUserId: string,
  targetUserId: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await client.query(
      `update identity.users
         set account_state = 'disabled', disabled_at = now()
       where id = $1 and account_state <> 'disabled'`,
      [targetUserId],
    );
    const revoked = await revokeAllUserSessions(client, targetUserId, 'account_disabled');
    await recordAudit(client, {
      action: 'account.disabled',
      result: 'success',
      actorUserId,
      subjectUserId: targetUserId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { sessionsRevoked: revoked },
    });
  });
}
