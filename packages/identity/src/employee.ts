import { randomUUID } from 'node:crypto';
import { serverEnvironment } from '@jksh/config';
import { withTransaction, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  CreateEmployeeCommand,
  EmployeeCreated,
  EmployeeSummary,
} from '@jksh/contracts';
import { authorize, FRESH_AUTH_SECONDS } from './authorize.js';
import { generateEmployeeCode } from './ids.js';
import { hashPin, isValidPinFormat, isWeakPin, pinLookup } from './pin.js';
import { recordAudit } from './audit.js';
import { IdentityError } from './errors.js';
import type { RequestMeta } from './admin-auth.js';

interface OutletScope {
  organization_id: string;
  franchise_id: string;
  brand_id: string;
  timezone: string;
}

async function outletScope(pool: Pool, outletId: string): Promise<OutletScope> {
  const { rows } = await pool.query<OutletScope>(
    `select o.organization_id, o.franchise_id, f.brand_id, o.timezone
       from identity.outlets o
       join identity.franchises f on f.id = o.franchise_id
      where o.id = $1 and o.status = 'active'`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return rows[0];
}

async function assertPinUnique(
  client: PoolClient,
  outletId: string,
  lookup: Buffer,
  exceptUserId: string,
): Promise<void> {
  const { rows } = await client.query<{ user_id: string }>(
    `select user_id from identity.employee_pins
      where outlet_id = $1 and pin_lookup = $2 and user_id <> $3`,
    [outletId, lookup, exceptUserId],
  );
  if (rows[0]) {
    throw new IdentityError('pin_not_unique', 'That PIN is already in use at this outlet');
  }
}

async function writePin(
  client: PoolClient,
  params: { userId: string; outletId: string; pin: string; setBy: string | null },
): Promise<void> {
  if (!isValidPinFormat(params.pin)) {
    throw new IdentityError('invalid_pin', 'PIN must be four digits');
  }
  if (isWeakPin(params.pin)) {
    throw new IdentityError('invalid_pin', 'Choose a less predictable PIN');
  }
  const secret = serverEnvironment().identityTokenSecret;
  const lookup = pinLookup(secret, params.outletId, params.pin);
  await assertPinUnique(client, params.outletId, lookup, params.userId);
  const hash = await hashPin(params.pin);
  await client.query(
    `insert into identity.employee_pins
       (user_id, outlet_id, pin_hash, pin_lookup, set_by, set_at, updated_at)
     values ($1,$2,$3,$4,$5, now(), now())
     on conflict (user_id) do update
       set pin_hash = excluded.pin_hash,
           pin_lookup = excluded.pin_lookup,
           set_by = excluded.set_by,
           updated_at = now()`,
    [params.userId, params.outletId, hash, lookup, params.setBy],
  );
  await client.query(
    `insert into identity.pin_attempts (user_id, outlet_id, failed_count)
     values ($1,$2,0)
     on conflict (user_id) do update
       set failed_count = 0, last_failed_at = null, locked_until = null`,
    [params.userId, params.outletId],
  );
}

export async function createEmployee(
  pool: Pool,
  actor: ActorContext,
  cmd: CreateEmployeeCommand,
  meta: RequestMeta = {},
): Promise<EmployeeCreated> {
  const scope = await outletScope(pool, cmd.outletId);
  const decision = authorize(actor, 'identity.employee.manage', {
    organizationId: scope.organization_id,
    franchiseId: scope.franchise_id,
    outletId: cmd.outletId,
  });
  if (!decision.allowed) {
    throw new IdentityError('forbidden', `Denied: ${decision.reason}`);
  }

  return withTransaction(pool, async (client) => {
    const userId = randomUUID();
    await client.query(
      `insert into identity.users (id, full_name, phone, account_state, is_internal, has_auth_login)
       values ($1,$2,$3,'active',false,false)`,
      [userId, cmd.fullName, cmd.phone],
    );

    let employeeCode = generateEmployeeCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await client.query(
        `select 1 from identity.store_employees where employee_code = $1`,
        [employeeCode],
      );
      if (clash.rowCount === 0) break;
      employeeCode = generateEmployeeCode();
    }

    await client.query(
      `insert into identity.store_employees
         (user_id, outlet_id, franchise_id, employee_code, full_name, phone, created_by)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, cmd.outletId, scope.franchise_id, employeeCode, cmd.fullName, cmd.phone, actor.userId],
    );

    await client.query(
      `insert into identity.memberships
         (user_id, role, organization_id, brand_id, franchise_id, outlet_id, created_by)
       values ($1,'store_employee',$2,$3,$4,$5,$6)`,
      [userId, scope.organization_id, scope.brand_id, scope.franchise_id, cmd.outletId, actor.userId],
    );

    let pinSet = false;
    if (cmd.initialPin) {
      await writePin(client, {
        userId,
        outletId: cmd.outletId,
        pin: cmd.initialPin,
        setBy: actor.userId,
      });
      pinSet = true;
    }

    await recordAudit(client, {
      action: 'employee.created',
      result: 'success',
      actorUserId: actor.userId,
      subjectUserId: userId,
      sessionId: actor.sessionId,
      organizationId: scope.organization_id,
      franchiseId: scope.franchise_id,
      outletId: cmd.outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { employeeCode, pinSet },
    });
    if (pinSet) {
      await recordAudit(client, {
        action: 'pin.set',
        result: 'success',
        actorUserId: actor.userId,
        subjectUserId: userId,
        sessionId: actor.sessionId,
        organizationId: scope.organization_id,
        franchiseId: scope.franchise_id,
        outletId: cmd.outletId,
        correlationId: meta.correlationId ?? randomUUID(),
      });
    }

    return { employeeId: employeeCode, userId, outletId: cmd.outletId, fullName: cmd.fullName, pinSet };
  });
}

export async function resetEmployeePin(
  pool: Pool,
  actor: ActorContext,
  input: { userId: string; newPin: string },
  meta: RequestMeta = {},
): Promise<void> {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      outlet_id: string;
      franchise_id: string;
    }>(
      `select outlet_id, franchise_id from identity.store_employees where user_id = $1`,
      [input.userId],
    );
    const row = rows[0];
    if (!row) throw new IdentityError('not_found', 'Employee not found');

    const scope = await outletScope(pool, row.outlet_id);
    // PIN reset is a sensitive action: require a fresh OTP session.
    const decision = authorize(
      actor,
      'identity.employee.manage',
      {
        organizationId: scope.organization_id,
        franchiseId: scope.franchise_id,
        outletId: row.outlet_id,
      },
      { requireStepUpWithinSeconds: FRESH_AUTH_SECONDS },
    );
    if (!decision.allowed) {
      throw new IdentityError('forbidden', `Denied: ${decision.reason}`, {
        details: { reason: decision.reason },
      });
    }

    await writePin(client, {
      userId: input.userId,
      outletId: row.outlet_id,
      pin: input.newPin,
      setBy: actor.userId,
    });
    await recordAudit(client, {
      action: 'pin.reset',
      result: 'success',
      actorUserId: actor.userId,
      subjectUserId: input.userId,
      sessionId: actor.sessionId,
      organizationId: scope.organization_id,
      franchiseId: scope.franchise_id,
      outletId: row.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
    });
  });
}

export async function listEmployees(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
): Promise<EmployeeSummary[]> {
  const scope = await outletScope(pool, outletId);
  const decision = authorize(actor, 'identity.employee.manage', {
    organizationId: scope.organization_id,
    franchiseId: scope.franchise_id,
    outletId,
  });
  if (!decision.allowed) {
    throw new IdentityError('forbidden', `Denied: ${decision.reason}`);
  }

  const { rows } = await pool.query<{
    user_id: string;
    employee_code: string;
    full_name: string;
    phone: string;
    account_state: EmployeeSummary['accountState'];
    pin_set: boolean;
    locked_until: Date | null;
  }>(
    `select se.user_id,
            se.employee_code,
            se.full_name,
            se.phone,
            u.account_state,
            (ep.user_id is not null) as pin_set,
            pa.locked_until
       from identity.store_employees se
       join identity.users u on u.id = se.user_id
       left join identity.employee_pins ep on ep.user_id = se.user_id
       left join identity.pin_attempts pa on pa.user_id = se.user_id
      where se.outlet_id = $1
      order by se.full_name`,
    [outletId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    employeeId: row.employee_code,
    fullName: row.full_name,
    phone: row.phone,
    outletId,
    accountState: row.account_state,
    pinSet: row.pin_set,
    ...(row.locked_until ? { lockedUntil: row.locked_until.toISOString() } : {}),
  }));
}
