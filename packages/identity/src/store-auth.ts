import { randomUUID } from 'node:crypto';
import { serverEnvironment } from '@jksh/config';
import { withTransaction, type Pool, type PoolClient } from '@jksh/db';
import type { PinLoginCommand, PinLoginResult } from '@jksh/contracts';
import {
  attemptGate,
  pinLookup,
  registerFailure,
  registerSuccess,
  verifyPinHash,
  type AttemptState,
} from './pin.js';
import { parseTerminalCredential, mintSessionToken } from './tokens.js';
import { createSession } from './session-context.js';
import { recordAudit } from './audit.js';
import type { RequestMeta } from './admin-auth.js';

export interface PinLoginOutput {
  result: PinLoginResult;
  sessionToken?: string;
}

const EMPTY: AttemptState = { failedCount: 0, lastFailedAt: null, lockedUntil: null };

async function loadUserAttempt(
  client: PoolClient,
  userId: string,
): Promise<AttemptState> {
  const { rows } = await client.query<{
    failed_count: number;
    last_failed_at: Date | null;
    locked_until: Date | null;
  }>(
    `select failed_count, last_failed_at, locked_until
       from identity.pin_attempts where user_id = $1`,
    [userId],
  );
  const row = rows[0];
  return row
    ? {
        failedCount: row.failed_count,
        lastFailedAt: row.last_failed_at,
        lockedUntil: row.locked_until,
      }
    : { ...EMPTY };
}

async function saveUserAttempt(
  client: PoolClient,
  userId: string,
  outletId: string,
  state: AttemptState,
): Promise<void> {
  await client.query(
    `insert into identity.pin_attempts (user_id, outlet_id, failed_count, last_failed_at, locked_until)
     values ($1,$2,$3,$4,$5)
     on conflict (user_id) do update
       set failed_count = excluded.failed_count,
           last_failed_at = excluded.last_failed_at,
           locked_until = excluded.locked_until`,
    [userId, outletId, state.failedCount, state.lastFailedAt, state.lockedUntil],
  );
}

async function loadTerminalAttempt(
  client: PoolClient,
  terminalId: string,
): Promise<AttemptState> {
  const { rows } = await client.query<{
    failed_count: number;
    last_failed_at: Date | null;
    locked_until: Date | null;
  }>(
    `select failed_count, last_failed_at, locked_until
       from identity.terminal_pin_attempts where terminal_id = $1`,
    [terminalId],
  );
  const row = rows[0];
  return row
    ? {
        failedCount: row.failed_count,
        lastFailedAt: row.last_failed_at,
        lockedUntil: row.locked_until,
      }
    : { ...EMPTY };
}

async function saveTerminalAttempt(
  client: PoolClient,
  terminalId: string,
  state: AttemptState,
): Promise<void> {
  await client.query(
    `insert into identity.terminal_pin_attempts
       (terminal_id, failed_count, last_failed_at, locked_until, window_started_at)
     values ($1,$2,$3,$4, now())
     on conflict (terminal_id) do update
       set failed_count = excluded.failed_count,
           last_failed_at = excluded.last_failed_at,
           locked_until = excluded.locked_until`,
    [terminalId, state.failedCount, state.lastFailedAt, state.lockedUntil],
  );
}

function reject(
  reason: 'invalid' | 'locked' | 'terminal_revoked' | 'offline_expired',
  retryAfterSeconds?: number,
): PinLoginOutput {
  return {
    result: {
      outcome: 'rejected',
      reason,
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    },
  };
}

/**
 * Four-digit PIN login on a registered terminal. A PIN never authenticates
 * without a valid terminal credential. Failures throttle both the employee and
 * the terminal; repeated failures hard-lock.
 */
export async function pinLogin(
  pool: Pool,
  cmd: PinLoginCommand,
  meta: RequestMeta = {},
): Promise<PinLoginOutput> {
  const secret = serverEnvironment().identityTokenSecret;
  const correlationId = meta.correlationId ?? randomUUID();
  const now = new Date();

  const parsed = parseTerminalCredential(secret, cmd.terminalCredential);
  if (!parsed) return reject('invalid');

  return withTransaction(pool, async (client) => {
    const { rows: termRows } = await client.query<{
      id: string;
      outlet_id: string;
      organization_id: string;
      franchise_id: string;
      state: string;
    }>(
      `select id, outlet_id, organization_id, franchise_id, state
         from identity.terminals where id = $1 for update`,
      [parsed.terminalId],
    );
    const term = termRows[0];
    if (!term) return reject('invalid');

    const { rows: credRows } = await client.query<{ id: string }>(
      `select id from identity.terminal_credentials
        where terminal_id = $1 and nonce_hash = $2 and state = 'active'`,
      [term.id, parsed.nonceHash],
    );
    if (!credRows[0]) return reject('terminal_revoked');
    if (term.state === 'revoked') return reject('terminal_revoked');
    if (term.state !== 'active') return reject('terminal_revoked');

    // Terminal-level throttle first.
    const termAttempt = await loadTerminalAttempt(client, term.id);
    const termGate = attemptGate(termAttempt, now);
    if (termGate.blocked) {
      await recordAudit(client, {
        action: 'pin.locked',
        result: 'denied',
        organizationId: term.organization_id,
        franchiseId: term.franchise_id,
        outletId: term.outlet_id,
        terminalId: term.id,
        correlationId,
        metadata: { scope: 'terminal' },
      });
      return reject('locked', termGate.retryAfterSeconds);
    }

    const lookup = pinLookup(secret, term.outlet_id, cmd.pin);
    const { rows: pinRows } = await client.query<{
      user_id: string;
      pin_hash: string;
    }>(
      `select user_id, pin_hash from identity.employee_pins
        where outlet_id = $1 and pin_lookup = $2`,
      [term.outlet_id, lookup],
    );
    const pinRow = pinRows[0];

    const failTerminal = async (): Promise<AttemptState> => {
      const next = registerFailure(termAttempt, now);
      await saveTerminalAttempt(client, term.id, next);
      return next;
    };

    if (!pinRow) {
      const next = await failTerminal();
      await recordAudit(client, {
        action: 'pin.login_failed',
        result: 'failure',
        organizationId: term.organization_id,
        franchiseId: term.franchise_id,
        outletId: term.outlet_id,
        terminalId: term.id,
        correlationId,
        metadata: { reason: 'no_match' },
      });
      return reject('invalid', attemptGate(next, now).retryAfterSeconds || undefined);
    }

    const userAttempt = await loadUserAttempt(client, pinRow.user_id);
    const userGate = attemptGate(userAttempt, now);
    if (userGate.blocked) {
      return reject('locked', userGate.retryAfterSeconds);
    }

    const ok = await verifyPinHash(pinRow.pin_hash, cmd.pin);
    if (!ok) {
      const nextUser = registerFailure(userAttempt, now);
      await saveUserAttempt(client, pinRow.user_id, term.outlet_id, nextUser);
      await failTerminal();
      const hardLocked = (nextUser.lockedUntil?.getTime() ?? 0) > now.getTime();
      await recordAudit(client, {
        action: hardLocked ? 'pin.locked' : 'pin.login_failed',
        result: hardLocked ? 'denied' : 'failure',
        subjectUserId: pinRow.user_id,
        organizationId: term.organization_id,
        franchiseId: term.franchise_id,
        outletId: term.outlet_id,
        terminalId: term.id,
        correlationId,
        metadata: { failedCount: nextUser.failedCount },
      });
      return reject(
        'invalid',
        attemptGate(nextUser, now).retryAfterSeconds || undefined,
      );
    }

    // Success.
    await saveUserAttempt(client, pinRow.user_id, term.outlet_id, registerSuccess());
    await saveTerminalAttempt(client, term.id, registerSuccess());

    const { rows: empRows } = await client.query<{
      full_name: string;
      employee_code: string;
      account_state: string;
      membership_id: string | null;
      membership_status: string | null;
      outlet_name: string;
    }>(
      `select se.full_name,
              se.employee_code,
              u.account_state,
              m.id      as membership_id,
              m.status  as membership_status,
              o.name    as outlet_name
         from identity.store_employees se
         join identity.users u on u.id = se.user_id
         join identity.outlets o on o.id = se.outlet_id
         left join identity.memberships m
                on m.user_id = se.user_id
               and m.role = 'store_employee'
               and m.outlet_id = se.outlet_id
        where se.user_id = $1`,
      [pinRow.user_id],
    );
    const emp = empRows[0];
    if (
      emp?.account_state !== 'active' ||
      !emp.membership_id ||
      emp.membership_status !== 'active'
    ) {
      await recordAudit(client, {
        action: 'login.failed',
        result: 'denied',
        subjectUserId: pinRow.user_id,
        organizationId: term.organization_id,
        franchiseId: term.franchise_id,
        outletId: term.outlet_id,
        terminalId: term.id,
        correlationId,
        metadata: { surface: 'store', reason: 'membership_unavailable' },
      });
      return reject('invalid');
    }

    // Switching operator ends any prior open context on this terminal.
    await client.query(
      `update identity.workstation_sessions
         set state = 'ended', ended_at = now()
       where terminal_id = $1 and state in ('active','locked')`,
      [term.id],
    );

    const session = await createSession(client, {
      userId: pinRow.user_id,
      kind: 'store_pin',
      membershipId: emp.membership_id,
      device: meta.deviceLabel ? { label: meta.deviceLabel } : {},
    });
    const minted = mintSessionToken(session.id);
    await client.query(
      `update identity.sessions set refresh_token_hash = $2 where id = $1`,
      [session.id, minted.tokenHash],
    );

    const workstationId = randomUUID();
    await client.query(
      `insert into identity.workstation_sessions
         (id, session_id, terminal_id, outlet_id, operator_user_id, state)
       values ($1,$2,$3,$4,$5,'active')`,
      [workstationId, session.id, term.id, term.outlet_id, pinRow.user_id],
    );
    await client.query(
      `update identity.terminals set last_seen_at = now() where id = $1`,
      [term.id],
    );

    await recordAudit(client, {
      action: 'login.succeeded',
      result: 'success',
      actorUserId: pinRow.user_id,
      sessionId: session.id,
      organizationId: term.organization_id,
      franchiseId: term.franchise_id,
      outletId: term.outlet_id,
      terminalId: term.id,
      correlationId,
      metadata: { surface: 'store' },
    });
    await recordAudit(client, {
      action: 'workspace.selected',
      result: 'success',
      actorUserId: pinRow.user_id,
      sessionId: session.id,
      organizationId: term.organization_id,
      franchiseId: term.franchise_id,
      outletId: term.outlet_id,
      terminalId: term.id,
      correlationId,
      metadata: { membershipId: emp.membership_id, auto: true },
    });

    return {
      result: {
        outcome: 'resolved',
        sessionId: session.id,
        workstationSessionId: workstationId,
        employeeId: emp.employee_code,
        employeeName: emp.full_name,
        outletId: term.outlet_id,
        outletName: emp.outlet_name,
      },
      sessionToken: minted.token,
    };
  });
}

export async function lockWorkstation(
  pool: Pool,
  sessionId: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      id: string;
      terminal_id: string;
      outlet_id: string;
      operator_user_id: string;
    }>(
      `update identity.workstation_sessions
         set state = 'locked', locked_at = now()
       where session_id = $1 and state = 'active'
       returning id, terminal_id, outlet_id, operator_user_id`,
      [sessionId],
    );
    const row = rows[0];
    if (row) {
      await recordAudit(client, {
        action: 'terminal.locked',
        result: 'success',
        actorUserId: row.operator_user_id,
        sessionId,
        outletId: row.outlet_id,
        terminalId: row.terminal_id,
        correlationId: meta.correlationId ?? randomUUID(),
      });
    }
  });
}

export async function storeLogout(
  pool: Pool,
  sessionId: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ user_id: string }>(
      `select user_id from identity.sessions where id = $1`,
      [sessionId],
    );
    await client.query(
      `update identity.workstation_sessions
         set state = 'ended', ended_at = now()
       where session_id = $1 and state in ('active','locked')`,
      [sessionId],
    );
    await client.query(
      `update identity.sessions
         set state = 'revoked', revoked_at = now(), revoked_reason = 'logout'
       where id = $1 and state <> 'revoked'`,
      [sessionId],
    );
    await recordAudit(client, {
      action: 'logout',
      result: 'success',
      actorUserId: rows[0]?.user_id ?? null,
      sessionId,
      correlationId: meta.correlationId ?? randomUUID(),
    });
  });
}
