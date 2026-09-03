import { randomUUID } from 'node:crypto';
import type { PoolClient } from '@jksh/db';
import type {
  AccountState,
  ActorContext,
  Membership,
  Role,
  SessionKind,
  SessionSummary,
} from '@jksh/contracts';
import { IdentityError } from './errors.js';
import { recordAudit } from './audit.js';
import { parseSessionToken, sessionNonceMatches } from './tokens.js';

const IDLE_MINUTES: Record<SessionKind, number> = { admin: 60, store_pin: 30 };
const ABSOLUTE_HOURS: Record<SessionKind, number> = { admin: 12, store_pin: 16 };

export interface SessionRow {
  id: string;
  user_id: string;
  kind: SessionKind;
  state: 'active' | 'step_up_required' | 'expired' | 'revoked';
  membership_id: string | null;
  refresh_token_hash: string | null;
  auth_provider_ref: string | null;
  created_at: Date;
  authenticated_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
}

export interface CreateSessionParams {
  userId: string;
  kind: SessionKind;
  membershipId?: string | null;
  refreshTokenHash?: string | null;
  authProviderRef?: string | null;
  device?: Record<string, unknown>;
  ip?: string | null;
  now?: Date;
}

export async function createSession(
  client: PoolClient,
  params: CreateSessionParams,
): Promise<SessionRow> {
  const now = params.now ?? new Date();
  const id = randomUUID();
  const idle = new Date(now.getTime() + IDLE_MINUTES[params.kind] * 60_000);
  const absolute = new Date(now.getTime() + ABSOLUTE_HOURS[params.kind] * 3_600_000);
  const { rows } = await client.query<SessionRow>(
    `insert into identity.sessions
       (id, user_id, kind, state, membership_id, refresh_token_hash,
        auth_provider_ref, device, ip, created_at, authenticated_at,
        last_seen_at, idle_expires_at, absolute_expires_at)
     values ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$9,$9,$10,$11)
     returning *`,
    [
      id,
      params.userId,
      params.kind,
      params.membershipId ?? null,
      params.refreshTokenHash ?? null,
      params.authProviderRef ?? null,
      JSON.stringify(params.device ?? {}),
      params.ip ?? null,
      now,
      idle,
      absolute,
    ],
  );
  const row = rows[0];
  if (!row) throw new IdentityError('conflict', 'Session insert returned no row');
  return row;
}

export async function loadSessionRow(
  client: PoolClient,
  sessionId: string,
): Promise<SessionRow | null> {
  const { rows } = await client.query<SessionRow>(
    `select * from identity.sessions where id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

/** Validate liveness; lazily flip an idle/absolute-expired session to expired. */
export async function assertLiveSession(
  client: PoolClient,
  sessionId: string,
  now = new Date(),
): Promise<SessionRow> {
  const row = await loadSessionRow(client, sessionId);
  if (!row) throw new IdentityError('session_not_found', 'Session not found');
  if (row.state === 'revoked') {
    throw new IdentityError('session_expired', 'Session has been revoked');
  }
  if (
    row.state === 'expired' ||
    row.idle_expires_at.getTime() <= now.getTime() ||
    row.absolute_expires_at.getTime() <= now.getTime()
  ) {
    if (row.state !== 'expired') {
      await client.query(
        `update identity.sessions set state = 'expired' where id = $1`,
        [sessionId],
      );
    }
    throw new IdentityError('session_expired', 'Session has expired');
  }
  return row;
}

export async function touchSession(
  client: PoolClient,
  sessionId: string,
  kind: SessionKind,
  now = new Date(),
): Promise<void> {
  const idle = new Date(now.getTime() + IDLE_MINUTES[kind] * 60_000);
  await client.query(
    `update identity.sessions
       set last_seen_at = $2, idle_expires_at = $3
     where id = $1 and state = 'active'`,
    [sessionId, now, idle],
  );
}

interface ActorRow {
  user_id: string;
  account_state: AccountState;
  authenticated_at: Date;
  membership_id: string;
  role: Role;
  membership_status: 'active' | 'suspended' | 'revoked';
  organization_id: string;
  brand_id: string | null;
  franchise_id: string | null;
  outlet_id: string | null;
}

/**
 * Build the full authorization context from a session that has a resolved
 * workspace. Throws with a stable code when the session or account is not usable.
 */
export async function loadActorContext(
  client: PoolClient,
  sessionId: string,
  now = new Date(),
): Promise<ActorContext> {
  const session = await assertLiveSession(client, sessionId, now);
  if (!session.membership_id) {
    throw new IdentityError('forbidden', 'No workspace selected for this session');
  }

  const { rows } = await client.query<ActorRow>(
    `select u.id                as user_id,
            u.account_state      as account_state,
            s.authenticated_at   as authenticated_at,
            m.id                 as membership_id,
            m.role               as role,
            m.status             as membership_status,
            m.organization_id    as organization_id,
            m.brand_id           as brand_id,
            m.franchise_id       as franchise_id,
            m.outlet_id          as outlet_id
       from identity.sessions s
       join identity.users u        on u.id = s.user_id
       join identity.memberships m  on m.id = s.membership_id
      where s.id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) throw new IdentityError('session_not_found', 'Session context missing');

  if (row.account_state === 'disabled' || row.account_state === 'locked') {
    await recordAudit(client, {
      action: 'disabled_account.access_attempt',
      result: 'denied',
      actorUserId: row.user_id,
      sessionId,
      organizationId: row.organization_id,
    });
    throw new IdentityError(
      row.account_state === 'disabled' ? 'account_disabled' : 'account_locked',
      'Account is not active',
    );
  }

  const membership: Membership = {
    id: row.membership_id,
    userId: row.user_id,
    role: row.role,
    status: row.membership_status,
    scope: {
      organizationId: row.organization_id,
      ...(row.brand_id ? { brandId: row.brand_id } : {}),
      ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
      ...(row.outlet_id ? { outletId: row.outlet_id } : {}),
    },
  };

  const secondsSinceStepUp = Math.max(
    0,
    Math.floor((now.getTime() - row.authenticated_at.getTime()) / 1000),
  );

  return {
    userId: row.user_id,
    accountState: row.account_state,
    sessionId,
    sessionActive: session.state === 'active',
    membership,
    secondsSinceStepUp,
    ...(row.outlet_id ? { outletId: row.outlet_id } : {}),
  };
}

/**
 * Verify an opaque session cookie value: correct shape, nonce matches the stored
 * hash, and the session is live. Returns the session row; throws IdentityError
 * otherwise. Also slides the idle timeout.
 */
export async function authenticateSessionToken(
  client: PoolClient,
  token: string | undefined | null,
  now = new Date(),
): Promise<SessionRow> {
  if (!token) throw new IdentityError('unauthenticated', 'No session');
  const parsed = parseSessionToken(token);
  if (!parsed) throw new IdentityError('unauthenticated', 'Malformed session');

  const row = await loadSessionRow(client, parsed.sessionId);
  if (!row?.refresh_token_hash) {
    throw new IdentityError('session_not_found', 'Session not found');
  }
  if (!sessionNonceMatches(parsed.nonceHash, row.refresh_token_hash)) {
    throw new IdentityError('unauthenticated', 'Session token mismatch');
  }
  const live = await assertLiveSession(client, parsed.sessionId, now);
  await touchSession(client, live.id, live.kind, now);
  return live;
}

export async function revokeSession(
  client: PoolClient,
  sessionId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await client.query(
    `update identity.sessions
       set state = 'revoked', revoked_at = $2, revoked_reason = $3
     where id = $1 and state <> 'revoked'`,
    [sessionId, now, reason],
  );
}

/** Revoke every active session for a user (account disabled / permission change). */
export async function revokeAllUserSessions(
  client: PoolClient,
  userId: string,
  reason: string,
  now = new Date(),
): Promise<number> {
  const { rowCount } = await client.query(
    `update identity.sessions
       set state = 'revoked', revoked_at = $2, revoked_reason = $3
     where user_id = $1 and state = 'active'`,
    [userId, now, reason],
  );
  return rowCount ?? 0;
}

export async function listUserSessions(
  client: PoolClient,
  userId: string,
  currentSessionId: string,
): Promise<SessionSummary[]> {
  const { rows } = await client.query<{
    id: string;
    kind: SessionKind;
    state: SessionSummary['state'];
    created_at: Date;
    last_seen_at: Date;
    absolute_expires_at: Date;
    idle_expires_at: Date;
    device: Record<string, unknown>;
  }>(
    `select id, kind, state, created_at, last_seen_at, absolute_expires_at,
            idle_expires_at, device
       from identity.sessions
      where user_id = $1
      order by last_seen_at desc
      limit 50`,
    [userId],
  );
  return rows.map((row) => {
    const device: SessionSummary['device'] = {};
    const ua = asString(row.device.userAgent);
    const ip = asString(row.device.ip);
    const label = asString(row.device.label);
    if (ua) device.userAgent = ua;
    if (ip) device.ip = ip;
    if (label) device.label = label;
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      createdAt: row.created_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      absoluteExpiresAt: row.absolute_expires_at.toISOString(),
      idleExpiresAt: row.idle_expires_at.toISOString(),
      device,
      current: row.id === currentSessionId,
    };
  });
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
