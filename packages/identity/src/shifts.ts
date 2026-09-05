import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  BillingWindow,
  CashSessionSummary,
  CloseCashSessionCommand,
  ForceCloseShiftCommand,
  OpenCashSessionCommand,
  ShiftSummary,
  StartShiftCommand,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { IdentityError } from './errors';
import { businessDateString } from './membership';
import type { RequestMeta } from './admin-auth';

async function outletContext(
  client: PoolClient,
  outletId: string,
): Promise<{
  organizationId: string;
  franchiseId: string | null;
  timezone: string;
  status: string;
}> {
  const { rows } = await client.query<{
    organization_id: string;
    franchise_id: string | null;
    timezone: string;
    status: string;
  }>(`select organization_id, franchise_id, timezone, status from billing.outlets where id = $1`, [
    outletId,
  ]);
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return {
    organizationId: rows[0].organization_id,
    franchiseId: rows[0].franchise_id,
    timezone: rows[0].timezone,
    status: rows[0].status,
  };
}

/** The employee id an operator acts as; admins have none. */
function operatorEmployeeId(actor: ActorContext): string {
  if (actor.kind !== 'operator' || !actor.employeeId) {
    throw new IdentityError('forbidden', 'A store operator session is required');
  }
  return actor.employeeId;
}

/** The operator's own display name (visible to them under operator RLS). */
async function employeeName(client: PoolClient, employeeId: string): Promise<string> {
  const { rows } = await client.query<{ full_name: string }>(
    `select full_name from identity.store_employees where id = $1`,
    [employeeId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Employee not found');
  return rows[0].full_name;
}

// ---- Cash session -------------------------------------------------------

export async function openCashSession(
  pool: Pool,
  actor: ActorContext,
  cmd: OpenCashSessionCommand,
  meta: RequestMeta = {},
): Promise<{ id: string; businessDate: string }> {
  const outletId = actor.outletId;
  if (!outletId) throw new IdentityError('forbidden', 'No outlet in session');
  const employeeId = operatorEmployeeId(actor);
  ensureAllowed(actor, 'billing.cash_session.open', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId,
  });

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlet = await outletContext(client, outletId);
    if (outlet.status !== 'active') {
      throw new IdentityError('outlet_not_active', 'Outlet is not active');
    }
    const open = await client.query(
      `select 1 from billing.cash_sessions where outlet_id = $1 and status = 'open'`,
      [outletId],
    );
    if (open.rowCount) {
      throw new IdentityError('conflict', 'A cash session is already open for this outlet');
    }
    const id = randomUUID();
    const bday = businessDateString(new Date(), outlet.timezone);
    await client.query(
      `insert into billing.cash_sessions
         (id, organization_id, franchise_id, outlet_id, business_date, opened_by_employee_id,
          opened_by_name, opening_cash, denominations)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        outlet.organizationId,
        outlet.franchiseId,
        outletId,
        bday,
        employeeId,
        await employeeName(client, employeeId),
        cmd.openingCash,
        cmd.denominations ? JSON.stringify(cmd.denominations) : null,
      ],
    );
    await recordAudit(client, {
      action: 'cash_session.opened',
      result: 'success',
      actorEmployeeId: employeeId,
      organizationId: outlet.organizationId,
      franchiseId: outlet.franchiseId,
      outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { cashSessionId: id, businessDate: bday, openingCash: cmd.openingCash },
    });
    return { id, businessDate: bday };
  });
}

/** Expected cash = opening + Cash sales for the session. Cash refunds
 *  (Stage 5) will subtract here once billing.refunds exists. */
async function expectedCashFor(client: PoolClient, cashSessionId: string): Promise<string> {
  const { rows } = await client.query<{ expected: string }>(
    `select cs.opening_cash + coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) as expected
       from billing.cash_sessions cs
       left join billing.bills b on b.cash_session_id = cs.id
       left join billing.payments p on p.bill_id = b.id
      where cs.id = $1
      group by cs.opening_cash`,
    [cashSessionId],
  );
  return rows[0]?.expected ?? '0.00';
}

export async function closeCashSession(
  pool: Pool,
  actor: ActorContext,
  cashSessionId: string,
  cmd: CloseCashSessionCommand,
  meta: RequestMeta = {},
): Promise<CashSessionSummary> {
  const employeeId = operatorEmployeeId(actor);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      outlet_id: string;
      organization_id: string;
      franchise_id: string | null;
      status: string;
    }>(
      `select outlet_id, organization_id, franchise_id, status
         from billing.cash_sessions where id = $1 for update`,
      [cashSessionId],
    );
    const session = rows[0];
    if (!session) throw new IdentityError('not_found', 'Cash session not found');
    ensureAllowed(actor, 'billing.cash_session.close', {
      organizationId: session.organization_id,
      ...(session.franchise_id ? { franchiseId: session.franchise_id } : {}),
      outletId: session.outlet_id,
    });
    if (session.status !== 'open') {
      throw new IdentityError('conflict', 'Cash session is already closed');
    }

    const expected = await expectedCashFor(client, cashSessionId);
    const variance = (Number(cmd.countedCash) - Number(expected)).toFixed(2);
    if (Number(variance) !== 0 && !cmd.varianceReason) {
      throw new IdentityError('validation', 'A reason is required for a non-zero cash variance');
    }

    await client.query(
      `update billing.cash_sessions
          set status = 'closed', closed_by_employee_id = $2, closed_by_name = $3, closed_at = now(),
              counted_cash = $4, expected_cash = $5, variance = $6,
              variance_reason = $7, denominations = coalesce($8, denominations)
        where id = $1`,
      [
        cashSessionId,
        employeeId,
        await employeeName(client, employeeId),
        cmd.countedCash,
        expected,
        variance,
        cmd.varianceReason ?? null,
        cmd.denominations ? JSON.stringify(cmd.denominations) : null,
      ],
    );
    await recordAudit(client, {
      action: 'cash_session.closed',
      result: 'success',
      actorEmployeeId: employeeId,
      organizationId: session.organization_id,
      franchiseId: session.franchise_id,
      outletId: session.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { cashSessionId, variance, hasReason: !!cmd.varianceReason },
    });
    return loadCashSession(client, cashSessionId);
  });
}

async function loadCashSession(
  client: PoolClient,
  cashSessionId: string,
): Promise<CashSessionSummary> {
  const { rows } = await client.query<{
    id: string;
    outlet_id: string;
    status: CashSessionSummary['status'];
    business_date: string;
    opened_by_employee_id: string;
    opened_by_name: string;
    opened_at: Date;
    opening_cash: string;
    closed_by_employee_id: string | null;
    closed_by_name: string | null;
    closed_at: Date | null;
    counted_cash: string | null;
    expected_cash: string | null;
    variance: string | null;
    variance_reason: string | null;
  }>(
    // business_date is cast to text - see the note in bills.ts loadBill.
    `select id, outlet_id, status, business_date::text as business_date, opened_by_employee_id,
            opened_by_name, opened_at, opening_cash, closed_by_employee_id, closed_by_name,
            closed_at, counted_cash, expected_cash, variance, variance_reason
       from billing.cash_sessions where id = $1`,
    [cashSessionId],
  );
  const r = rows[0];
  if (!r) throw new IdentityError('not_found', 'Cash session not found');
  return {
    id: r.id,
    outletId: r.outlet_id,
    status: r.status,
    businessDate: r.business_date,
    openedByEmployeeId: r.opened_by_employee_id,
    openedByName: r.opened_by_name,
    openedAt: r.opened_at.toISOString(),
    openingCash: r.opening_cash,
    closedByEmployeeId: r.closed_by_employee_id,
    closedByName: r.closed_by_name,
    closedAt: r.closed_at ? r.closed_at.toISOString() : null,
    countedCash: r.counted_cash,
    expectedCash: r.expected_cash,
    variance: r.variance,
    varianceReason: r.variance_reason,
  };
}

export async function getOpenCashSession(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
): Promise<CashSessionSummary | null> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from billing.cash_sessions where outlet_id = $1 and status = 'open'`,
      [outletId],
    );
    return rows[0] ? loadCashSession(client, rows[0].id) : null;
  });
}

// ---- Employee shift ---------------------------------------------------

export async function startShift(
  pool: Pool,
  actor: ActorContext,
  cmd: StartShiftCommand,
  meta: RequestMeta = {},
): Promise<ShiftSummary> {
  const outletId = actor.outletId;
  if (!outletId) throw new IdentityError('forbidden', 'No outlet in session');
  const employeeId = operatorEmployeeId(actor);
  ensureAllowed(actor, 'billing.shift.open', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId,
  });

  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlet = await outletContext(client, outletId);
    // Resume an already-open shift instead of creating a second one.
    const open = await client.query<{ id: string }>(
      `select id from billing.employee_shifts where employee_id = $1 and status = 'open'`,
      [employeeId],
    );
    if (open.rows[0]) return loadShift(client, open.rows[0].id);

    const id = randomUUID();
    const bday = businessDateString(new Date(), outlet.timezone);
    await client.query(
      `insert into billing.employee_shifts
         (id, organization_id, franchise_id, outlet_id, employee_id, employee_name, terminal_id,
          business_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        outlet.organizationId,
        outlet.franchiseId,
        outletId,
        employeeId,
        await employeeName(client, employeeId),
        cmd.terminalId ?? actor.terminalId ?? null,
        bday,
      ],
    );
    await recordAudit(client, {
      action: 'shift.started',
      result: 'success',
      actorEmployeeId: employeeId,
      organizationId: outlet.organizationId,
      franchiseId: outlet.franchiseId,
      outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { shiftId: id, businessDate: bday },
    });
    return loadShift(client, id);
  });
}

export async function endShift(
  pool: Pool,
  actor: ActorContext,
  shiftId: string,
  meta: RequestMeta = {},
): Promise<ShiftSummary> {
  const employeeId = operatorEmployeeId(actor);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      status: string;
      outlet_id: string;
      organization_id: string;
      franchise_id: string | null;
      employee_id: string;
    }>(
      `select status, outlet_id, organization_id, franchise_id, employee_id
         from billing.employee_shifts where id = $1 for update`,
      [shiftId],
    );
    const shift = rows[0];
    if (!shift) throw new IdentityError('not_found', 'Shift not found');
    ensureAllowed(actor, 'billing.shift.close', {
      organizationId: shift.organization_id,
      ...(shift.franchise_id ? { franchiseId: shift.franchise_id } : {}),
      outletId: shift.outlet_id,
    });
    if (shift.status !== 'open') throw new IdentityError('conflict', 'Shift is not open');

    await client.query(
      `update billing.employee_shifts
          set status = 'ended', ended_at = now(), ended_by_employee_id = $2 where id = $1`,
      [shiftId, employeeId],
    );
    await recordAudit(client, {
      action: 'shift.ended',
      result: 'success',
      actorEmployeeId: employeeId,
      organizationId: shift.organization_id,
      franchiseId: shift.franchise_id,
      outletId: shift.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { shiftId },
    });
    return loadShift(client, shiftId);
  });
}

export async function forceCloseShift(
  pool: Pool,
  actor: ActorContext,
  shiftId: string,
  cmd: ForceCloseShiftCommand,
  meta: RequestMeta = {},
): Promise<ShiftSummary> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{
      status: string;
      outlet_id: string;
      organization_id: string;
      franchise_id: string | null;
    }>(
      `select status, outlet_id, organization_id, franchise_id
         from billing.employee_shifts where id = $1 for update`,
      [shiftId],
    );
    const shift = rows[0];
    if (!shift) throw new IdentityError('not_found', 'Shift not found');
    ensureAllowed(actor, 'billing.shift.close', {
      organizationId: shift.organization_id,
      ...(shift.franchise_id ? { franchiseId: shift.franchise_id } : {}),
      outletId: shift.outlet_id,
    });
    if (shift.status !== 'open') throw new IdentityError('conflict', 'Shift is not open');

    await client.query(
      `update billing.employee_shifts
          set status = 'force_closed', ended_at = now(),
              force_close_reason = $2, forced_by_account_id = $3
        where id = $1`,
      [shiftId, cmd.reason, actor.accountId ?? null],
    );
    await recordAudit(client, {
      action: 'shift.force_closed',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: shift.organization_id,
      franchiseId: shift.franchise_id,
      outletId: shift.outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { shiftId, reason: cmd.reason },
    });
    return loadShift(client, shiftId);
  });
}

async function loadShift(client: PoolClient, shiftId: string): Promise<ShiftSummary> {
  const { rows } = await client.query<{
    id: string;
    outlet_id: string;
    employee_id: string;
    employee_name: string;
    status: ShiftSummary['status'];
    business_date: string;
    started_at: Date;
    ended_at: Date | null;
    bill_count: number;
    force_close_reason: string | null;
  }>(
    // business_date is cast to text - see the note in bills.ts loadBill.
    `select id, outlet_id, employee_id, employee_name, status, business_date::text as business_date,
            started_at, ended_at, bill_count, force_close_reason
       from billing.employee_shifts where id = $1`,
    [shiftId],
  );
  const r = rows[0];
  if (!r) throw new IdentityError('not_found', 'Shift not found');
  return {
    id: r.id,
    outletId: r.outlet_id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    status: r.status,
    businessDate: r.business_date,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at ? r.ended_at.toISOString() : null,
    billCount: r.bill_count,
    forceCloseReason: r.force_close_reason,
  };
}

export async function getShift(
  pool: Pool,
  actor: ActorContext,
  shiftId: string,
): Promise<ShiftSummary> {
  return withActorContext(pool, contextForActor(actor), (client) => loadShift(client, shiftId));
}

export async function listOpenShifts(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
): Promise<ShiftSummary[]> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from billing.employee_shifts
        where outlet_id = $1 and status = 'open' order by started_at`,
      [outletId],
    );
    return Promise.all(rows.map((r) => loadShift(client, r.id)));
  });
}

/** Billing is blocked when an open shift or cash session belongs to an earlier
 *  business date than the outlet's current one - it must be closed first. */
export async function outletBillingWindow(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
): Promise<BillingWindow> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const outlet = await outletContext(client, outletId);
    const today = businessDateString(new Date(), outlet.timezone);
    const staleCash = await client.query(
      `select 1 from billing.cash_sessions
        where outlet_id = $1 and status = 'open' and business_date < $2 limit 1`,
      [outletId, today],
    );
    const staleShift = await client.query(
      `select 1 from billing.employee_shifts
        where outlet_id = $1 and status = 'open' and business_date < $2 limit 1`,
      [outletId, today],
    );
    const reason: BillingWindow['reason'] = staleCash.rowCount
      ? 'stale_cash_session'
      : staleShift.rowCount
        ? 'stale_shift'
        : null;
    return { outletId, businessDate: today, blocked: reason !== null, reason };
  });
}
