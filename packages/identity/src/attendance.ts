import { randomUUID } from 'node:crypto';
import { withActorContext, type Pool, type PoolClient } from '@jksh/db';
import type {
  ActorContext,
  CheckInCommand,
  CheckOutCommand,
  CorrectAttendanceCommand,
  SetOutletScheduleCommand,
  AttendanceSessionView,
  EmployeeActivitySummary,
} from '@jksh/contracts';
import { contextForActor } from './db-context';
import { ensureAllowed } from './authz';
import { recordAudit } from './audit';
import { emitNotification } from './notification';
import { IdentityError } from './errors';
import { businessDateString } from './membership';
import type { RequestMeta } from './admin-auth';

function operatorContext(actor: ActorContext): { employeeId: string; outletId: string } {
  if (actor.kind !== 'operator' || !actor.employeeId || !actor.outletId) {
    throw new IdentityError('forbidden', 'A store operator session is required');
  }
  return { employeeId: actor.employeeId, outletId: actor.outletId };
}

/** Minutes since local midnight for an instant, in the outlet's IANA
 *  timezone - never `Date.prototype.getHours()`/`setHours()`, which read the
 *  Node process's own OS timezone instead (the same class of bug already
 *  fixed for business-date columns elsewhere in this codebase). */
function wallClockMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

async function outletTimezone(client: PoolClient, outletId: string): Promise<string> {
  const { rows } = await client.query<{ timezone: string }>(
    `select timezone from billing.outlets where id = $1`,
    [outletId],
  );
  if (!rows[0]) throw new IdentityError('not_found', 'Outlet not found');
  return rows[0].timezone;
}

/** Check in for the current PIN-authenticated employee - entirely separate
 *  from starting a Billing shift ("One action never silently creates,
 *  closes, or edits another record"). */
export async function checkIn(
  pool: Pool,
  actor: ActorContext,
  cmd: CheckInCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  const { employeeId, outletId } = operatorContext(actor);
  ensureAllowed(actor, 'identity.attendance.self', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const existing = await client.query(
      `select 1 from identity.attendance_sessions where employee_id = $1 and status = 'open'`,
      [employeeId],
    );
    if (existing.rowCount) {
      throw new IdentityError('conflict', 'Already checked in - check out first', {
        details: { code: 'already_checked_in' },
      });
    }
    const timezone = await outletTimezone(client, outletId);
    const businessDate = businessDateString(new Date(), timezone);
    const id = randomUUID();
    const employee = await client.query<{
      full_name: string;
      organization_id: string;
      franchise_id: string | null;
    }>(
      `select se.full_name, o.organization_id, o.franchise_id
         from identity.store_employees se join billing.outlets o on o.id = se.outlet_id
        where se.id = $1`,
      [employeeId],
    );
    if (!employee.rows[0]) throw new IdentityError('not_found', 'Employee not found');
    await client.query(
      `insert into identity.attendance_sessions
         (id, organization_id, franchise_id, outlet_id, employee_id, employee_name, terminal_id,
          business_date, checked_in_device_time)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        employee.rows[0].organization_id,
        employee.rows[0].franchise_id,
        outletId,
        employeeId,
        employee.rows[0].full_name,
        actor.terminalId ?? null,
        businessDate,
        cmd.deviceTime ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'attendance.checked_in',
      result: 'success',
      actorEmployeeId: employeeId,
      organizationId: employee.rows[0].organization_id,
      franchiseId: employee.rows[0].franchise_id,
      outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { attendanceSessionId: id },
    });
    return { id };
  });
}

export async function checkOut(
  pool: Pool,
  actor: ActorContext,
  cmd: CheckOutCommand,
  meta: RequestMeta = {},
): Promise<{ id: string }> {
  const { employeeId } = operatorContext(actor);
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const open = await client.query<{
      id: string;
      organization_id: string;
      franchise_id: string | null;
      outlet_id: string;
    }>(
      `select id, organization_id, franchise_id, outlet_id from identity.attendance_sessions
        where employee_id = $1 and status = 'open'`,
      [employeeId],
    );
    if (!open.rows[0]) {
      throw new IdentityError('conflict', 'No open attendance session', {
        details: { code: 'not_checked_in' },
      });
    }
    await client.query(
      `update identity.attendance_sessions
          set status = 'closed', checked_out_at = now(), checked_out_device_time = $2
        where id = $1`,
      [open.rows[0].id, cmd.deviceTime ?? null],
    );
    await recordAudit(client, {
      action: 'attendance.checked_out',
      result: 'success',
      actorEmployeeId: employeeId,
      organizationId: open.rows[0].organization_id,
      franchiseId: open.rows[0].franchise_id,
      outletId: open.rows[0].outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { attendanceSessionId: open.rows[0].id },
    });
    return { id: open.rows[0].id };
  });
}

export async function correctAttendance(
  pool: Pool,
  actor: ActorContext,
  attendanceSessionId: string,
  cmd: CorrectAttendanceCommand,
  meta: RequestMeta = {},
): Promise<void> {
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const session = await client.query<{
      organization_id: string;
      franchise_id: string | null;
      outlet_id: string;
    }>(
      `select organization_id, franchise_id, outlet_id from identity.attendance_sessions where id = $1`,
      [attendanceSessionId],
    );
    if (!session.rows[0]) throw new IdentityError('not_found', 'Attendance session not found');
    ensureAllowed(actor, 'identity.attendance.oversee', {
      organizationId: actor.scope.organizationId,
      ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
      outletId: session.rows[0].outlet_id,
    });
    await client.query(
      `insert into identity.attendance_corrections
         (id, attendance_session_id, corrected_checked_in_at, corrected_checked_out_at, reason,
          corrected_by_account_id)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        randomUUID(),
        attendanceSessionId,
        cmd.checkedInAt ?? null,
        cmd.checkedOutAt ?? null,
        cmd.reason,
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'attendance.corrected',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: session.rows[0].organization_id,
      franchiseId: session.rows[0].franchise_id,
      outletId: session.rows[0].outlet_id,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { attendanceSessionId, reason: cmd.reason },
    });
    return session.rows[0];
  }).then(async (s) => {
    await emitNotification(pool, {
      organizationId: s.organization_id,
      ...(s.franchise_id ? { franchiseId: s.franchise_id } : {}),
      outletId: s.outlet_id,
      recipientRole: 'franchise_owner',
      category: 'workforce',
      severity: 'info',
      title: 'Attendance record corrected',
      body: cmd.reason,
      entityType: 'attendance_session',
      entityId: attendanceSessionId,
      dedupKey: `attendance-corrected:${attendanceSessionId}:${String(Date.now())}`,
    });
  });
}

export async function setOutletSchedule(
  pool: Pool,
  actor: ActorContext,
  outletId: string,
  cmd: SetOutletScheduleCommand,
  meta: RequestMeta = {},
): Promise<void> {
  ensureAllowed(actor, 'identity.attendance.schedule_manage', {
    organizationId: actor.scope.organizationId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    await client.query(
      `insert into identity.outlet_schedules
         (outlet_id, expected_start_time, expected_end_time, grace_minutes, updated_by)
       values ($1,$2,$3,$4,$5)
       on conflict (outlet_id) do update set
         expected_start_time = excluded.expected_start_time,
         expected_end_time = excluded.expected_end_time,
         grace_minutes = excluded.grace_minutes,
         updated_by = excluded.updated_by`,
      [
        outletId,
        cmd.expectedStartTime,
        cmd.expectedEndTime,
        cmd.graceMinutes,
        actor.accountId ?? null,
      ],
    );
    await recordAudit(client, {
      action: 'attendance.schedule_set',
      result: 'success',
      actorAccountId: actor.accountId,
      organizationId: actor.scope.organizationId,
      outletId,
      correlationId: meta.correlationId ?? randomUUID(),
      metadata: { expectedStartTime: cmd.expectedStartTime, graceMinutes: cmd.graceMinutes },
    });
  });
}

/** Lists attendance for one outlet/date, with late and missing-checkout
 *  flags computed at read time rather than mutated by a background job -
 *  "missing_checkout" simply means a still-open session from a date before
 *  the outlet's current business date. */
export async function listAttendance(
  pool: Pool,
  actor: ActorContext,
  opts: { outletId: string; businessDate?: string; employeeId?: string },
): Promise<AttendanceSessionView[]> {
  ensureAllowed(actor, 'identity.attendance.oversee', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId: opts.outletId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const timezone = await outletTimezone(client, opts.outletId);
    const today = businessDateString(new Date(), timezone);
    const params: unknown[] = [opts.outletId];
    let where = `outlet_id = $1`;
    if (opts.businessDate) {
      params.push(opts.businessDate);
      where += ` and business_date = $${String(params.length)}`;
    }
    if (opts.employeeId) {
      params.push(opts.employeeId);
      where += ` and employee_id = $${String(params.length)}`;
    }
    const schedule = await client.query<{
      expected_start_time: string;
      grace_minutes: number;
    }>(
      `select expected_start_time::text, grace_minutes from identity.outlet_schedules where outlet_id = $1`,
      [opts.outletId],
    );

    const rows = await client.query<{
      id: string;
      outlet_id: string;
      employee_id: string;
      employee_name: string;
      business_date: string;
      checked_in_at: Date;
      checked_out_at: Date | null;
      status: 'open' | 'closed' | 'missing_checkout';
    }>(
      `select id, outlet_id, employee_id, employee_name, business_date::text as business_date,
              checked_in_at, checked_out_at, status
         from identity.attendance_sessions where ${where} order by checked_in_at desc`,
      params,
    );
    const sessionIds = rows.rows.map((r) => r.id);
    const corrections =
      sessionIds.length === 0
        ? { rows: [] }
        : await client.query<{
            id: string;
            attendance_session_id: string;
            corrected_checked_in_at: Date | null;
            corrected_checked_out_at: Date | null;
            reason: string;
            corrected_by_name: string | null;
            corrected_at: Date;
          }>(
            `select c.id, c.attendance_session_id, c.corrected_checked_in_at,
                    c.corrected_checked_out_at, c.reason, ap.display_name as corrected_by_name,
                    c.corrected_at
               from identity.attendance_corrections c
               left join identity.account_profiles ap on ap.id = c.corrected_by_account_id
              where c.attendance_session_id = any($1::uuid[])
              order by c.corrected_at desc`,
            [sessionIds],
          );

    const sched = schedule.rows[0];
    return rows.rows.map((r) => {
      const status: AttendanceSessionView['status'] =
        r.status === 'open' && r.business_date < today ? 'missing_checkout' : r.status;
      let isLate = false;
      if (sched) {
        const [h, m] = sched.expected_start_time.split(':').map(Number);
        const expectedMinutes = (h ?? 0) * 60 + (m ?? 0) + sched.grace_minutes;
        isLate = wallClockMinutes(r.checked_in_at, timezone) > expectedMinutes;
      }
      const durationMinutes = r.checked_out_at
        ? Math.round((r.checked_out_at.getTime() - r.checked_in_at.getTime()) / 60000)
        : null;
      return {
        id: r.id,
        outletId: r.outlet_id,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        businessDate: r.business_date,
        checkedInAt: r.checked_in_at.toISOString(),
        checkedOutAt: r.checked_out_at?.toISOString() ?? null,
        status,
        isLate,
        durationMinutes,
        corrections: corrections.rows
          .filter((c) => c.attendance_session_id === r.id)
          .map((c) => ({
            id: c.id,
            correctedCheckedInAt: c.corrected_checked_in_at?.toISOString() ?? null,
            correctedCheckedOutAt: c.corrected_checked_out_at?.toISOString() ?? null,
            reason: c.reason,
            correctedByName: c.corrected_by_name,
            correctedAt: c.corrected_at.toISOString(),
          })),
      };
    });
  });
}

/** Read-only review signals, never payroll inputs or automatic proof of
 *  misconduct (`workforce-attendance.md`). */
export async function getEmployeeActivitySummary(
  pool: Pool,
  actor: ActorContext,
  opts: { outletId: string; employeeId: string; businessDate: string },
): Promise<EmployeeActivitySummary> {
  ensureAllowed(actor, 'identity.attendance.oversee', {
    organizationId: actor.scope.organizationId,
    ...(actor.scope.franchiseId ? { franchiseId: actor.scope.franchiseId } : {}),
    outletId: opts.outletId,
  });
  return withActorContext(pool, contextForActor(actor), async (client) => {
    const employee = await client.query<{ full_name: string }>(
      `select full_name from identity.store_employees where id = $1`,
      [opts.employeeId],
    );
    if (!employee.rows[0]) throw new IdentityError('not_found', 'Employee not found');

    const bills = await client.query<{
      bill_count: string;
      discount_count: string;
      first_at: Date | null;
      last_at: Date | null;
    }>(
      `select count(*) as bill_count,
              count(*) filter (where discount_total::numeric > 0) as discount_count,
              min(committed_at) as first_at, max(committed_at) as last_at
         from billing.bills
        where outlet_id = $1 and employee_id = $2 and business_date = $3`,
      [opts.outletId, opts.employeeId, opts.businessDate],
    );
    const refunds = await client.query<{ refund_count: string }>(
      `select count(*) as refund_count
         from billing.refunds
        where outlet_id = $1 and actor_employee_id = $2 and created_at::date = $3`,
      [opts.outletId, opts.employeeId, opts.businessDate],
    );
    const b = bills.rows[0];
    return {
      employeeId: opts.employeeId,
      employeeName: employee.rows[0].full_name,
      businessDate: opts.businessDate,
      billCount: Number(b?.bill_count ?? 0),
      discountCount: Number(b?.discount_count ?? 0),
      refundCount: Number(refunds.rows[0]?.refund_count ?? 0),
      firstActivityAt: b?.first_at?.toISOString() ?? null,
      lastActivityAt: b?.last_at?.toISOString() ?? null,
    };
  });
}
