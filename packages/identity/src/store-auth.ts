import { randomUUID } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type { ActorContext, PinLoginCommand, PinLoginResult } from '@jksh/contracts';
import { contextForActor, systemContext } from './db-context';
import {
  attemptGate,
  isHardLocked,
  pinLookup,
  registerFailure,
  registerSuccess,
  verifyDummyPin,
  verifyPinHash,
  TERMINAL_LOCKOUT_POLICY,
  type AttemptState,
} from './pin';
import {
  mintOperatorToken,
  nonceHashMatches,
  parseOperatorToken,
  parseTerminalCredential,
} from './tokens';
import { recordVerifiedStaffAttendance } from './attendance';
import { finishEmployeeWithClient } from './shifts';
import { IdentityError } from './errors';
import { recordAudit } from './audit';
import type { RequestMeta } from './admin-auth';

export interface PinLoginOutput {
  result: PinLoginResult;
  operatorToken?: string;
}

/** A PIN login lasts a full working day; the operator ends it explicitly with
 *  "End shift", or the next employee's PIN takes the terminal over. */
const OPERATOR_SESSION_HOURS = 24;

/** Only the terminal/outlet state is disclosed; every bad-PIN case is generic. */
type RejectReason = 'invalid' | 'locked' | 'terminal_revoked' | 'outlet_inactive';

function reject(reason: RejectReason, retryAfterSeconds?: number): PinLoginOutput {
  return {
    result: { outcome: 'rejected', reason, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
  };
}

async function loadTerminalAttempt(client: PoolClient, terminalId: string): Promise<AttemptState> {
  const { rows } = await client.query<{
    failed_count: number;
    last_failed_at: Date | null;
    lock_time: Date | null;
  }>(
    `insert into identity.terminal_pin_attempts (terminal_id) values ($1)
       on conflict (terminal_id) do update set terminal_id = excluded.terminal_id
     returning failed_count, last_failed_at, lock_time`,
    [terminalId],
  );
  const r = rows[0] ?? { failed_count: 0, last_failed_at: null, lock_time: null };
  return { failedCount: r.failed_count, lastFailedAt: r.last_failed_at, lockedUntil: r.lock_time };
}

async function saveTerminalAttempt(
  client: PoolClient,
  terminalId: string,
  state: AttemptState,
): Promise<void> {
  await client.query(
    `update identity.terminal_pin_attempts
       set failed_count = $2, last_failed_at = $3, lock_time = $4
     where terminal_id = $1`,
    [terminalId, state.failedCount, state.lastFailedAt, state.lockedUntil],
  );
}

async function authenticatePin(
  pool: Pool,
  cmd: PinLoginCommand,
  meta: RequestMeta = {},
  attendance?: { employeeId: string; action: 'check-in' | 'check-out'; outletId: string },
): Promise<PinLoginOutput | { attendanceRecorded: true }> {
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
    if (attendance && attendance.outletId !== term.outlet_id) return reject('invalid');

    // ---- Terminal-wide brute-force gate (checked before any employee lookup).
    const termAttempt = await loadTerminalAttempt(client, term.id);
    const termGate = attemptGate(termAttempt, now, TERMINAL_LOCKOUT_POLICY);
    if (termGate.blocked) {
      await recordAudit(client, {
        action: 'pin.locked',
        result: 'denied',
        organizationId: term.organization_id,
        franchiseId: term.franchise_id,
        outletId: term.outlet_id,
        terminalId: term.id,
        correlationId,
        metadata: { scope: 'terminal', terminalFailedCount: termAttempt.failedCount },
      });
      return reject('locked', termGate.retryAfterSeconds);
    }

    /** Record a failed attempt against the terminal (and the employee, if known),
     *  audit it without any PIN, and return the generic invalid response. */
    const fail = async (
      reason: string,
      employee?: { id: string; state: AttemptState },
    ): Promise<PinLoginOutput> => {
      const nextTerm = registerFailure(termAttempt, now, TERMINAL_LOCKOUT_POLICY);
      await saveTerminalAttempt(client, term.id, nextTerm);
      let empHardLocked = false;
      let empRetry = 0;
      if (employee) {
        const nextEmp = registerFailure(employee.state, now);
        await client.query(
          `update identity.store_employees
             set failed_attempts = $2, last_failed_at = $3, lock_time = $4 where id = $1`,
          [employee.id, nextEmp.failedCount, nextEmp.lastFailedAt, nextEmp.lockedUntil],
        );
        empHardLocked = isHardLocked(nextEmp, now);
        empRetry = attemptGate(nextEmp, now).retryAfterSeconds;
      }
      const termHardLocked = isHardLocked(nextTerm, now);
      await recordAudit(client, {
        action: termHardLocked || empHardLocked ? 'pin.locked' : 'pin.login_failed',
        result: termHardLocked || empHardLocked ? 'denied' : 'failure',
        ...(employee ? { actorEmployeeId: employee.id } : {}),
        organizationId: term.organization_id,
        franchiseId: term.franchise_id,
        outletId: term.outlet_id,
        terminalId: term.id,
        correlationId,
        metadata: { reason, terminalFailedCount: nextTerm.failedCount },
      });
      const retry = Math.max(
        attemptGate(nextTerm, now, TERMINAL_LOCKOUT_POLICY).retryAfterSeconds,
        empRetry,
      );
      return reject('invalid', retry || undefined);
    };

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
      await verifyDummyPin(cmd.pin); // equalize timing vs. a real verification
      return fail('no_match');
    }

    const empState: AttemptState = {
      failedCount: emp.failed_attempts,
      lastFailedAt: emp.last_failed_at,
      lockedUntil: emp.lock_time,
    };
    // An already-locked employee, an inactive employee, and a wrong PIN all go
    // through `fail()`: increment the terminal-wide counter, equalize timing,
    // emit the safe audit event, and return the one generic `invalid` response.
    if (attemptGate(empState, now).blocked) {
      await verifyDummyPin(cmd.pin);
      return fail('employee_locked', { id: emp.id, state: empState });
    }
    if (emp.status !== 'active') {
      await verifyDummyPin(cmd.pin);
      return fail('employee_inactive', { id: emp.id, state: empState });
    }
    const ok = await verifyPinHash(emp.pin_hash, cmd.pin);
    if (!ok) return fail('wrong_pin', { id: emp.id, state: empState });

    if (attendance && emp.id !== attendance.employeeId)
      return fail('employee_mismatch', { id: emp.id, state: empState });

    // Success: reset both counters.
    await saveTerminalAttempt(client, term.id, registerSuccess());
    await client.query(
      `update identity.store_employees
         set failed_attempts = 0, last_failed_at = null, lock_time = null where id = $1`,
      [emp.id],
    );
    if (attendance) {
      const staffActor: ActorContext = {
        kind: 'operator',
        role: 'store_employee',
        employeeId: emp.id,
        scope: {
          organizationId: term.organization_id,
          ...(term.franchise_id ? { franchiseId: term.franchise_id } : {}),
          outletId: term.outlet_id,
        },
        outletId: term.outlet_id,
        terminalId: term.id,
        sessionActive: true,
        secondsSinceAuth: 0,
      };
      // PIN verification never changes the cashier's operator session.
      if (attendance.action === 'check-out') {
        await finishEmployeeWithClient(client, staffActor, meta);
      } else {
        await recordVerifiedStaffAttendance(client, staffActor, attendance.action, meta);
      }
      return { attendanceRecorded: true };
    }
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
    await client.query(`update identity.terminals set last_validated_at = now() where id = $1`, [
      term.id,
    ]);

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

    // Successful PIN login records attendance once; returning cashiers retain their original time.
    await recordVerifiedStaffAttendance(
      client,
      {
        kind: 'operator',
        role: 'store_employee',
        employeeId: emp.id,
        scope: {
          organizationId: term.organization_id,
          ...(term.franchise_id ? { franchiseId: term.franchise_id } : {}),
          outletId: term.outlet_id,
        },
        outletId: term.outlet_id,
        terminalId: term.id,
        sessionActive: true,
        secondsSinceAuth: 0,
      },
      'check-in',
      meta,
      true,
    );

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

export async function pinLogin(
  pool: Pool,
  cmd: PinLoginCommand,
  meta: RequestMeta = {},
): Promise<PinLoginOutput> {
  const result = await authenticatePin(pool, cmd, meta);
  if ('attendanceRecorded' in result) throw new Error('Unexpected attendance result');
  return result;
}

export async function recordStaffAttendance(
  pool: Pool,
  actor: ActorContext,
  cmd: PinLoginCommand & { employeeId: string; action: 'check-in' | 'check-out' },
  meta: RequestMeta = {},
): Promise<void> {
  if (actor.kind !== 'operator' || !actor.sessionActive || !actor.outletId) {
    throw new IdentityError('forbidden', 'Sign in to use staff attendance');
  }
  if (cmd.action === 'check-out' && cmd.employeeId === actor.employeeId) {
    throw new IdentityError(
      'validation',
      'Use Finish shift to review your expenses and close or hand over the register.',
    );
  }
  const result = await authenticatePin(pool, cmd, meta, { ...cmd, outletId: actor.outletId });
  if (!('attendanceRecorded' in result)) {
    throw new IdentityError(
      'forbidden',
      'PIN could not be verified. Check the selected employee and try again later.',
    );
  }
}

export async function listOutletStaff(
  pool: Pool,
  actor: ActorContext,
): Promise<
  { id: string; name: string; checkedIn: boolean; isCurrentCashier: boolean; shiftOpen: boolean }[]
> {
  if (actor.kind !== 'operator' || !actor.sessionActive || !actor.outletId) {
    throw new IdentityError('forbidden', 'Sign in to view staff');
  }
  // Deliberately limited roster: no PIN hashes, phone numbers or attendance history.
  return withActorContext(pool, systemContext(), async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      checkedIn: boolean;
      isCurrentCashier: boolean;
      shiftOpen: boolean;
    }>(
      `select e.id, e.full_name as name, exists (
         select 1 from identity.attendance_sessions a where a.employee_id = e.id and a.status = 'open'
       ) as "checkedIn", e.id = $2 as "isCurrentCashier", exists (
         select 1 from billing.employee_shifts s where s.employee_id = e.id and s.status = 'open'
       ) as "shiftOpen" from identity.store_employees e
       where e.outlet_id = $1 and e.status = 'active' order by e.full_name`,
      [actor.outletId, actor.employeeId],
    );
    return rows;
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

export interface OperatorSummary {
  employeeName: string;
  employeeCode: string;
  outletName: string;
}

/** The operator's own name + outlet, read under operator RLS context. */
export async function getOperatorSummary(
  pool: Pool,
  actor: ActorContext,
): Promise<OperatorSummary | null> {
  if (actor.kind !== 'operator' || !actor.employeeId) return null;
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      full_name: string;
      employee_code: string;
      display_name: string;
    }>(
      `select se.full_name, se.employee_code, o.display_name
         from identity.store_employees se
         join billing.outlets o on o.id = se.outlet_id
        where se.id = $1`,
      [actor.employeeId],
    );
    const r = rows[0];
    return r
      ? { employeeName: r.full_name, employeeCode: r.employee_code, outletName: r.display_name }
      : null;
  });
}

/** End the operator session created moments ago (employee tapped "Not me"). */
export async function rejectOperatorSession(
  pool: Pool,
  token: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, systemContext(), async (client) => {
    const session = await loadOperatorSession(client, token);
    if (!session) return;
    await client.query(
      `update identity.operator_sessions
         set status = 'ended', ended_at = now(), revoked_reason = 'not_me'
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
      metadata: { reason: 'not_me' },
    });
  });
}
