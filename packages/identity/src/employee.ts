import { randomUUID } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  CreateEmployeeCommand,
  EmployeeCreated,
  EmployeeStatus,
  EmployeeSummary,
  SetEmployeeStatusCommand,
  UpdateEmployeeCommand,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed, ensureAllowedAudited } from './authz';
import { FRESH_AUTH_SECONDS } from './authorize';
import { generateEmployeeCode } from './ids';
import { hashPin, isValidPinFormat, isWeakPin, pinLookup } from './pin';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import type { RequestMeta } from './admin-auth';

interface OutletScope {
  organization_id: string;
  franchise_id: string | null;
}

async function outletScope(client: PoolClient, outletId: string): Promise<OutletScope> {
  const { rows } = await client.query<OutletScope & { status: string }>(
    `select organization_id, franchise_id, status from billing.outlets where id = $1`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return { organization_id: rows[0].organization_id, franchise_id: rows[0].franchise_id };
}

async function writePin(
  client: PoolClient,
  params: { employeeId: string; outletId: string; pin: string; setBy: string | null },
): Promise<void> {
  if (!isValidPinFormat(params.pin))
    throw new IdentityError('invalid_pin', 'PIN must be four digits');
  if (isWeakPin(params.pin))
    throw new IdentityError('invalid_pin', 'Choose a less predictable PIN');
  const secret = identityTokenSecret();
  const lookup = pinLookup(secret, params.outletId, params.pin);

  const clash = await client.query(
    `select 1 from identity.store_employees
      where outlet_id = $1 and pin_lookup = $2 and id <> $3`,
    [params.outletId, lookup, params.employeeId],
  );
  if (clash.rowCount)
    throw new IdentityError('pin_not_unique', 'That PIN is already used at this outlet');

  const hash = await hashPin(params.pin);
  await client.query(
    `update identity.store_employees
       set pin_hash = $2, pin_lookup = $3, pin_version = pin_version + 1,
           pin_set_at = now(), pin_set_by = $4,
           failed_attempts = 0, last_failed_at = null, lock_time = null
     where id = $1`,
    [params.employeeId, hash, lookup, params.setBy],
  );
}

export async function createEmployee(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateEmployeeCommand,
  meta: RequestMeta = {},
): Promise<EmployeeCreated> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const scope = await outletScope(client, cmd.outletId);
    ensureAllowed(actor, 'identity.employee.manage', {
      organizationId: scope.organization_id,
      ...(scope.franchise_id ? { franchiseId: scope.franchise_id } : {}),
      outletId: cmd.outletId,
    });

    const id = randomUUID();
    let employeeCode = generateEmployeeCode();
    for (let i = 0; i < 5; i += 1) {
      const c = await client.query(
        `select 1 from identity.store_employees where employee_code = $1`,
        [employeeCode],
      );
      if (c.rowCount === 0) break;
      employeeCode = generateEmployeeCode();
    }

    await client.query(
      `insert into identity.store_employees
         (id, outlet_id, organization_id, franchise_id, employee_code, full_name, mobile, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,'active',$8)`,
      [
        id,
        cmd.outletId,
        scope.organization_id,
        scope.franchise_id,
        employeeCode,
        cmd.fullName,
        cmd.mobile,
        actor.accountId ?? null,
      ],
    );
    await writePin(client, {
      employeeId: id,
      outletId: cmd.outletId,
      pin: cmd.initialPin,
      setBy: actor.accountId ?? null,
    });

    await recordAudit(client, {
      action: 'employee.created',
      result: 'success',
      actorAccountId: actor.accountId,
      subjectId: id,
      organizationId: scope.organization_id,
      franchiseId: scope.franchise_id,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { employeeCode },
    });
    await recordAudit(client, {
      action: 'pin.set',
      result: 'success',
      actorAccountId: actor.accountId,
      subjectId: id,
      organizationId: scope.organization_id,
      franchiseId: scope.franchise_id,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
    });

    return { employeeId: id, employeeCode, outletId: cmd.outletId, fullName: cmd.fullName };
  });
}

async function loadEmployee(
  client: PoolClient,
  employeeId: string,
): Promise<{ outlet_id: string; organization_id: string; franchise_id: string | null }> {
  const { rows } = await client.query<{
    outlet_id: string;
    organization_id: string;
    franchise_id: string | null;
  }>(
    `select outlet_id, organization_id, franchise_id from identity.store_employees where id = $1 for update`,
    [employeeId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Employee not found');
  return rows[0];
}

export async function updateEmployee(
  pool: Pool,
  actor: ActorContext,
  employeeId: string,
  cmd: UpdateEmployeeCommand,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, contextForActor(actor), async (client) => {
    const emp = await loadEmployee(client, employeeId);
    ensureAllowed(actor, 'identity.employee.manage', {
      organizationId: emp.organization_id,
      ...(emp.franchise_id ? { franchiseId: emp.franchise_id } : {}),
      outletId: emp.outlet_id,
    });
    const sets: string[] = [];
    const values: unknown[] = [employeeId];
    if (cmd.fullName !== undefined) {
      values.push(cmd.fullName);
      sets.push(`full_name = $${String(values.length)}`);
    }
    if (cmd.mobile !== undefined) {
      values.push(cmd.mobile);
      sets.push(`mobile = $${String(values.length)}`);
    }
    if (sets.length === 0) return;
    await client.query(
      `update identity.store_employees set ${sets.join(', ')} where id = $1`,
      values,
    );
    await recordAudit(client, {
      action: 'employee.updated',
      result: 'success',
      actorAccountId: actor.accountId,
      subjectId: employeeId,
      organizationId: emp.organization_id,
      franchiseId: emp.franchise_id,
      outletId: emp.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { fields: Object.keys(cmd) },
    });
  });
}

export async function setEmployeeStatus(
  pool: Pool,
  actor: ActorContext,
  employeeId: string,
  cmd: SetEmployeeStatusCommand,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, contextForActor(actor), async (client) => {
    const emp = await loadEmployee(client, employeeId);
    ensureAllowed(actor, 'identity.employee.manage', {
      organizationId: emp.organization_id,
      ...(emp.franchise_id ? { franchiseId: emp.franchise_id } : {}),
      outletId: emp.outlet_id,
    });
    await client.query(`update identity.store_employees set status = $2 where id = $1`, [
      employeeId,
      cmd.status,
    ]);
    // Disabling or suspending ends the employee's live operator sessions.
    if (cmd.status !== 'active') {
      await client.query(
        `update identity.operator_sessions
           set status = 'ended', ended_at = now(), revoked_reason = 'employee_' || $2
         where employee_id = $1 and status in ('active','locked')`,
        [employeeId, cmd.status],
      );
    }
    await recordAudit(client, {
      action: 'employee.status_changed',
      result: 'success',
      actorAccountId: actor.accountId,
      subjectId: employeeId,
      organizationId: emp.organization_id,
      franchiseId: emp.franchise_id,
      outletId: emp.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { status: cmd.status, ...(cmd.reason ? { reason: cmd.reason } : {}) },
    });
  });
}

export async function resetEmployeePin(
  pool: Pool,
  actor: ActorContext,
  employeeId: string,
  newPin: string,
  meta: RequestMeta = {},
): Promise<void> {
  await withActorContext(pool, contextForActor(actor), async (client) => {
    const emp = await loadEmployee(client, employeeId);
    await ensureAllowedAudited(
      pool,
      'pin.reset',
      actor,
      'identity.employee.manage',
      {
        organizationId: emp.organization_id,
        ...(emp.franchise_id ? { franchiseId: emp.franchise_id } : {}),
        outletId: emp.outlet_id,
      },
      { requireFreshAuthWithinSeconds: FRESH_AUTH_SECONDS },
    );
    await writePin(client, {
      employeeId,
      outletId: emp.outlet_id,
      pin: newPin,
      setBy: actor.accountId ?? null,
    });
    await recordAudit(client, {
      action: 'pin.reset',
      result: 'success',
      actorAccountId: actor.accountId,
      subjectId: employeeId,
      organizationId: emp.organization_id,
      franchiseId: emp.franchise_id,
      outletId: emp.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
    });
  });
}

export async function listEmployees(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
): Promise<EmployeeSummary[]> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const scope = await outletScope(client, outletId);
    ensureAllowed(actor, 'identity.employee.manage', {
      organizationId: scope.organization_id,
      ...(scope.franchise_id ? { franchiseId: scope.franchise_id } : {}),
      outletId,
    });
    const { rows } = await client.query<{
      id: string;
      employee_code: string;
      full_name: string;
      mobile: string;
      status: EmployeeStatus;
      pin_hash: string | null;
      lock_time: Date | null;
    }>(
      `select id, employee_code, full_name, mobile, status, pin_hash, lock_time
         from identity.store_employees where outlet_id = $1 order by full_name`,
      [outletId],
    );
    return rows.map((r) => ({
      id: r.id,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      mobile: r.mobile,
      outletId,
      status: r.status,
      pinSet: r.pin_hash !== null,
      ...(r.lock_time ? { lockedUntil: r.lock_time.toISOString() } : {}),
    }));
  });
}
