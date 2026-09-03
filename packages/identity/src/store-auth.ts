import { randomUUID } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, PinLoginCommand, PinLoginResult } from '@jksh/contracts';
import { systemContext } from './db-context.js';
import {
  attemptGate,
  pinLookup,
  registerFailure,
  registerSuccess,
  verifyPinHash,
  type AttemptState,
} from './pin.js';
import {
  mintOperatorToken,
  nonceHashMatches,
  parseOperatorToken,
  parseTerminalCredential,
} from './tokens.js';
import { recordAudit } from './audit.js';
import type { RequestMeta } from './admin-auth.js';

export interface PinLoginOutput {
  result: PinLoginResult;
  operatorToken?: string;
}

const OPERATOR_SESSION_HOURS = 16;

type RejectReason = 'invalid' | 'locked' | 'terminal_revoked' | 'employee_inactive' | 'outlet_inactive';

function reject(reason: RejectReason, retryAfterSeconds?: number): PinLoginOutput {
  return {
    result: { outcome: 'rejected', reason, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
  };
}

export async function pinLogin(
  pool: Pool,
  cmd: PinLoginCommand,
  meta: RequestMeta = {},
): Promise<PinLoginOutput> {
  const secret = identityTokenSecret();
  const correlationId = meta.correlationId ?? randomUUID();
  const now = new Date();

  const parsed = parseTerminalCredential(secret, cmd.terminalCredential);
  if (!parsed) return reject('invalid');

  return withActorContext(pool, systemContext(), async (client) => {
    const { rows: termRows } = await client.query<{
      id: string;
      outlet_id: string;
      organization_id: string;
      franchise_id: string | null;
      status: string;
    }>(
      `select id, outlet_id, organization_id, franchise_id, status
         from identity.terminals where id = $1 for update`,
      [parsed.terminalId],
    );
    const term = termRows[0];
    if (!term) return reject('invalid');

    const cred = await client.query(
      `select 1 from identity.terminal_credentials
        where terminal_id = $1 and nonce_hash = $2 and status = 'active'`,
      [term.id, parsed.nonceHash],
    );
    if (!cred.rowCount || term.status !== 'active') return reject('terminal_revoked');

    const outlet = await client.query<{ status: string; display_name: string }>(
      `select status, display_name from billing.outlets where id = $1`,
      [term.outlet_id],
    );
    if (outlet.rows[0]?.status !== 'active') return reject('outlet_inactive');

    const lookup = pinLookup(secret, term.outlet_id, cmd.pin);
    const { rows: empRows } = await client.query<{
      id: string;
      full_name: string;
      employee_code: string;
      status: string;
      pin_hash: string | null;
      failed_attempts: number;
      last_failed_at: Date | null;
      lock_time: Date | null;
    }>(
      `select id, full_name, employee_code, status, pin_hash, failed_attempts,
              last_failed_at, lock_time
         from identity.store_employees
        where outlet_id = $1 and pin_lookup = $2 for update`,
      [term.outlet_id, lookup],
    );
    const emp = empRows[0];

    if (!emp?.pin_hash) {
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
      return reject('invalid');
    }

    const state: AttemptState = {
      failedCount: emp.failed_attempts,
      lastFailedAt: emp.last_failed_at,
      lockedUntil: emp.lock_time,
    };
    const gate = attemptGate(state, now);
    if (gate.blocked) return reject('locked', gate.retryAfterSeconds);

    if (emp.status !== 'active') return reject('employee_inactive');

    const ok = await verifyPinHash(emp.pin_hash, cmd.pin);
    if (!ok) {
      const next = registerFailure(state, now);
      await client.query(
        `update identity.store_employees
           set failed_attempts = $2, last_failed_at = $3, lock_time = $4 where id = $1`,
        [emp.id, next.failedCount, next.lastFailedAt, next.lockedUntil],
      );
      const hardLocked = (next.lockedUntil?.getTime() ?? 0) > now.getTime();
      await recordAudit(client, {
        action: hardLocked ? 'pin.locked' : 'pin.login_failed',
        result: hardLocked ? 'denied' : 'failure',
        actorEmployeeId: emp.id,
        organizationId: term.organization_id,
        franchiseId: term.franchise_id,
        outletId: term.outlet_id,
        terminalId: term.id,
        correlationId,
        metadata: { failedCount: next.failedCount },
      });
      return reject('invalid', attemptGate(next, now).retryAfterSeconds || undefined);
    }

    // Success.
    const reset = registerSuccess();
    await client.query(
      `update identity.store_employees
         set failed_attempts = $2, last_failed_at = $3, lock_time = $4 where id = $1`,
      [emp.id, reset.failedCount, reset.lastFailedAt, reset.lockedUntil],
    );
    // Switching operator ends any prior open context on this terminal.
    await client.query(
      `update identity.operator_sessions
         set status = 'ended', ended_at = now(), revoked_reason = 'operator_switch'
       where terminal_id = $1 and status in ('active','locked')`,
      [term.id],
    );

    const operatorSessionId = randomUUID();
    const minted = mintOperatorToken(operatorSessionId);
    await client.query(
      `insert into identity.operator_sessions
         (id, employee_id, terminal_id, outlet_id, status, token_hash, device, expires_at)
       values ($1,$2,$3,$4,'active',$5,$6,$7)`,
      [
        operatorSessionId,
        emp.id,
        term.id,
        term.outlet_id,
        minted.tokenHash,
        JSON.stringify(meta.deviceLabel ? { label: meta.deviceLabel } : {}),
        new Date(now.getTime() + OPERATOR_SESSION_HOURS * 3_600_000),
      ],
    );
    await client.query(`update identity.terminals set last_validated_at = now() where id = $1`, [term.id]);

    await recordAudit(client, {
      action: 'login.succeeded',
      result: 'success',
      actorEmployeeId: emp.id,
      organizationId: term.organization_id,
      franchiseId: term.franchise_id,
      outletId: term.outlet_id,
      terminalId: term.id,
      sessionId: operatorSessionId,
      correlationId,
      metadata: { surface: 'store' },
    });

    return {
      result: {
        outcome: 'resolved',
        operatorSessionId,
        employeeId: emp.employee_code,
        employeeName: emp.full_name,
        outletId: term.outlet_id,
        outletName: outlet.rows[0].display_name,
      },
      operatorToken: minted.token,
    };
  });
}

async function loadOperatorSession(
  client: PoolClient,
  token: string,
): Promise<{
  id: string;
  employee_id: string;
  terminal_id: string;
  outlet_id: string;
  status: string;
  token_hash: string;
  expires_at: Date;
} | null> {
  const parsed = parseOperatorToken(token);
  if (!parsed) return null;
  const { rows } = await client.query<{
    id: string;
    employee_id: string;
    terminal_id: string;
    outlet_id: string;
    status: string;
    token_hash: string;
    expires_at: Date;
  }>(
    `select id, employee_id, terminal_id, outlet_id, status, token_hash, expires_at
       from identity.operator_sessions where id = $1`,
    [parsed.operatorSessionId],
  );
  const row = rows[0];
  if (!row || !nonceHashMatches(parsed.nonceHash, row.token_hash)) return null;
  return row;
}

export async function loadOperatorContext(
  pool: Pool,
  token: string | undefined | null,
  now = new Date(),
): Promise<ActorContext | null> {
  if (!token) return null;
  return withActorContext(pool, systemContext(), async (client) => {
    const session = await loadOperatorSession(client, token);
    if (!session) return null;
    if (session.status === 'ended' || session.expires_at.getTime() <= now.getTime()) return null;
    const { rows } = await client.query<{
      organization_id: string;
      franchise_id: string | null;
      emp_status: string;
      outlet_status: string;
      issued_at: Date;
    }>(
      `select t.organization_id, t.franchise_id, se.status as emp_status,
              o.status as outlet_status, os.issued_at
         from identity.operator_sessions os
         join identity.terminals t on t.id = os.terminal_id
         join identity.store_employees se on se.id = os.employee_id
         join billing.outlets o on o.id = os.outlet_id
        where os.id = $1`,
      [session.id],
    );
    const row = rows[0];
    if (!row) return null;
    if (row.emp_status !== 'active' || row.outlet_status !== 'active') return null;

    await client.query(`update identity.operator_sessions set last_seen_at = now() where id = $1`, [
      session.id,
    ]);

    return {
      kind: 'operator',
      employeeId: session.employee_id,
      role: 'store_employee',
      scope: {
        organizationId: row.organization_id,
        ...(row.franchise_id ? { franchiseId: row.franchise_id } : {}),
        outletId: session.outlet_id,
      },
      sessionActive: session.status === 'active',
      terminalId: session.terminal_id,
      outletId: session.outlet_id,
      secondsSinceAuth: Math.max(0, Math.floor((now.getTime() - row.issued_at.getTime()) / 1000)),
    };
  });
}

export async function lockOperator(
  pool: Pool,
  token: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, systemContext(), async (client) => {
    const session = await loadOperatorSession(client, token);
    if (session?.status !== 'active') return;
    await client.query(
      `update identity.operator_sessions set status = 'locked', locked_at = now() where id = $1`,
      [session.id],
    );
    await recordAudit(client, {
      action: 'operator.locked',
      result: 'success',
      actorEmployeeId: session.employee_id,
      outletId: session.outlet_id,
      terminalId: session.terminal_id,
      sessionId: session.id,
      correlationId: meta.correlationId ?? randomUUID(),
    });
  });
}

export async function endOperatorSession(
  pool: Pool,
  token: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, systemContext(), async (client) => {
    const session = await loadOperatorSession(client, token);
    if (!session) return;
    await client.query(
      `update identity.operator_sessions
         set status = 'ended', ended_at = now(), revoked_reason = 'logout'
       where id = $1 and status <> 'ended'`,
      [session.id],
    );
    await recordAudit(client, {
      action: 'operator.logout',
      result: 'success',
      actorEmployeeId: session.employee_id,
      outletId: session.outlet_id,
      terminalId: session.terminal_id,
      sessionId: session.id,
      correlationId: meta.correlationId ?? randomUUID(),
    });
  });
}
