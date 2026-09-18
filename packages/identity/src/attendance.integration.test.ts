/**
 * Workforce attendance - check-in/check-out, late/missing-checkout flags,
 * owner corrections, and scope denial (`workforce-attendance.md`), against a
 * real Postgres.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import { issueActivationCode, registerTerminal } from './terminal';
import { createEmployee } from './employee';
import {
  pinLogin,
  loadOperatorContext,
  recordStaffAttendance,
  listOutletStaff,
} from './store-auth';
import {
  checkIn,
  getOwnOpenAttendance,
  checkOut,
  correctAttendance,
  setOutletSchedule,
  listAttendance,
  getEmployeeActivitySummary,
} from './attendance';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerPhone: string;
let accountantPhone: string;
let brand: string;
let franchiseId: string;
let outletId: string;
let terminalCredential: string;
let pin: string;
let employeeId: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Att ${role}`, role === 'central_admin' || role === 'accountant'],
  );
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, brand_id, franchise_id)
     values ($1,$2,$3,$4,$5) on conflict do nothing`,
    [rows[0]!.id, role, JKSH_ORG, fId ? brand : null, fId],
  );
}

async function adminActor(phone: string): Promise<ActorContext> {
  const authUserId = randomUUID();
  const r = await resolveAdminAfterVerify(pool, { authUserId, phone });
  if (r.result.outcome !== 'single_workspace') throw new Error('expected single workspace');
  const a = await buildAdminActor(pool, { authUserId, membershipId: r.result.membershipId });
  if (!a) throw new Error('no actor');
  return a;
}

async function operator(): Promise<ActorContext> {
  const res = await pinLogin(pool, { terminalCredential, pin });
  if (res.result.outcome !== 'resolved' || !res.operatorToken) throw new Error('pin login failed');
  const a = await loadOperatorContext(pool, res.operatorToken);
  if (!a) throw new Error('no operator');
  return a;
}

describe.skipIf(!RUN)('Workforce attendance', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Attendance Test Brand', true)`,
      [brand, JKSH_ORG, `att-brand-${S}`],
    );
    adminPhone = `+9182${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9183${S.slice(-8).padStart(8, '0')}`;
    accountantPhone = `+9184${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `att-${S}`, `att-${S}`],
    );
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);
    await seedAccount(accountantPhone, 'accountant', null);

    outletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, JKSH_ORG, brand, franchiseId, `AttOut${S.slice(-4)}`, `attout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Attendance test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Attendance iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    pin = String(7000 + (Date.now() % 2000));
    employeeId = (
      await createEmployee(pool, owner, {
        outletId,
        fullName: 'Attendance Ravi',
        mobile: `+9188${S.slice(-8).padStart(8, '0')}`,
        initialPin: pin,
      })
    ).employeeId;
  }, 60_000);

  afterAll(async () => {
    try {
      await pool.query(
        `delete from identity.attendance_corrections where attendance_session_id in
           (select id from identity.attendance_sessions where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(`delete from identity.attendance_sessions where outlet_id = $1`, [outletId]);
      await pool.query(`delete from identity.outlet_schedules where outlet_id = $1`, [outletId]);
      await pool.query(`delete from identity.operator_sessions where outlet_id = $1`, [outletId]);
      await pool.query(
        `delete from identity.terminal_credentials where terminal_id in
           (select id from identity.terminals where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(`delete from identity.terminal_activation_codes where outlet_id = $1`, [
        outletId,
      ]);
      await pool.query(`delete from identity.terminals where outlet_id = $1`, [outletId]);
      await pool.query(`delete from identity.store_employees where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.outlets where id = $1`, [outletId]);
      await pool.query(`delete from identity.memberships where franchise_id = $1`, [franchiseId]);
      await pool.query(`delete from billing.franchises where id = $1`, [franchiseId]);
      await pool.query(`delete from identity.account_profiles where mobile = any($1::text[])`, [
        [adminPhone, ownerPhone, accountantPhone],
      ]);
      await pool.query(`delete from billing.brands where id = $1`, [brand]);
    } catch {
      /* best effort */
    }
    await pool.end();
  });

  it('checks in, rejects a duplicate check-in, then checks out', async () => {
    const op = await operator();
    expect(await getOwnOpenAttendance(pool, op)).toBeNull();
    const { id } = await checkIn(pool, op, {});
    expect(id).toBeTruthy();
    expect(await getOwnOpenAttendance(pool, op)).toEqual({
      id,
      checkedInAt: expect.any(String),
    });
    expect(await getOwnOpenAttendance(pool, { ...op, employeeId: randomUUID() })).toBeNull();
    await expect(checkIn(pool, op, {})).rejects.toThrow(/already_checked_in|Already checked in/);
    await checkOut(pool, op, {});
    expect(await getOwnOpenAttendance(pool, op)).toBeNull();
    // A fresh check-in is allowed once the previous session is closed.
    const second = await checkIn(pool, op, {});
    expect(second.id).not.toBe(id);
    await checkOut(pool, op, {});
  }, 30_000);

  it('records a colleague attendance with their PIN without switching the cashier', async () => {
    const login = await pinLogin(pool, { terminalCredential, pin });
    const cashier = (await loadOperatorContext(pool, login.operatorToken))!;
    const owner = await adminActor(ownerPhone);
    const colleaguePin = pin === '8264' ? '8265' : '8264';
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Kitchen colleague',
      mobile: '+9186' + S.slice(-8).padStart(8, '0'),
      initialPin: colleaguePin,
    });
    const colleague = (await listOutletStaff(pool, cashier)).find(
      (person) => person.name === 'Kitchen colleague',
    )!;
    expect(colleague.checkedIn).toBe(false);
    await recordStaffAttendance(pool, cashier, {
      terminalCredential,
      pin: colleaguePin,
      employeeId: colleague.id,
      action: 'check-in',
    });
    expect(
      (await listOutletStaff(pool, cashier)).find((person) => person.id === colleague.id)
        ?.checkedIn,
    ).toBe(true);
    expect((await loadOperatorContext(pool, login.operatorToken))?.employeeId).toBe(
      cashier.employeeId,
    );
    expect(await getOwnOpenAttendance(pool, cashier)).toBeNull();
    await recordStaffAttendance(pool, cashier, {
      terminalCredential,
      pin: colleaguePin,
      employeeId: colleague.id,
      action: 'check-out',
    });
    expect(
      (await listOutletStaff(pool, cashier)).find((person) => person.id === colleague.id)
        ?.checkedIn,
    ).toBe(false);
    await expect(
      recordStaffAttendance(pool, cashier, {
        terminalCredential,
        pin,
        employeeId: colleague.id,
        action: 'check-in',
      }),
    ).rejects.toThrow(/PIN could not/);
    expect(
      (await listOutletStaff(pool, cashier)).find((person) => person.id === colleague.id)
        ?.checkedIn,
    ).toBe(false);
    await expect(
      recordStaffAttendance(
        pool,
        { ...cashier, outletId: randomUUID() },
        { terminalCredential, pin: colleaguePin, employeeId: colleague.id, action: 'check-in' },
      ),
    ).rejects.toThrow(/PIN could not/);
    expect((await loadOperatorContext(pool, login.operatorToken))?.employeeId).toBe(
      cashier.employeeId,
    );
  });

  it('flags a session left open from a previous business day as missing_checkout, and applies late/grace correctly', async () => {
    const owner = await adminActor(ownerPhone);
    const admin = await adminActor(adminPhone);
    // Schedule config is Central-only; a Franchise Owner may only view/correct.
    await expect(
      setOutletSchedule(pool, owner, outletId, {
        expectedStartTime: '09:00',
        expectedEndTime: '18:00',
        graceMinutes: 15,
      }),
    ).rejects.toThrow(/Denied/);
    await setOutletSchedule(pool, admin, outletId, {
      expectedStartTime: '09:00',
      expectedEndTime: '18:00',
      graceMinutes: 15,
    });

    // Simulate a session opened yesterday that was never checked out, and one
    // opened well after the 09:15 grace cutoff today.
    const yesterday = randomUUID();
    await pool.query(
      `insert into identity.attendance_sessions
         (id, organization_id, franchise_id, outlet_id, employee_id, employee_name, business_date,
          checked_in_at, status)
       values ($1,$2,$3,$4,$5,'Attendance Ravi', (current_date - 1), now() - interval '1 day', 'open')`,
      [yesterday, JKSH_ORG, franchiseId, outletId, employeeId],
    );
    const lateToday = randomUUID();
    await pool.query(
      `insert into identity.attendance_sessions
         (id, organization_id, franchise_id, outlet_id, employee_id, employee_name, business_date,
          checked_in_at, checked_out_at, status)
       values ($1,$2,$3,$4,$5,'Attendance Ravi', current_date,
               date_trunc('day', now()) + interval '11 hours',
               date_trunc('day', now()) + interval '15 hours', 'closed')`,
      [lateToday, JKSH_ORG, franchiseId, outletId, employeeId],
    );

    const sessions = await listAttendance(pool, owner, { outletId, employeeId });
    const y = sessions.find((s) => s.id === yesterday);
    const l = sessions.find((s) => s.id === lateToday);
    expect(y?.status).toBe('missing_checkout');
    expect(l?.isLate).toBe(true);
    expect(l?.durationMinutes).toBe(4 * 60);

    // Correcting the missing-checkout session leaves the original row intact
    // and links an append-only correction instead.
    await correctAttendance(pool, owner, yesterday, {
      checkedOutAt: new Date().toISOString(),
      reason: 'forgot to check out, confirmed with employee',
    });
    const afterCorrection = await listAttendance(pool, owner, { outletId, employeeId });
    const correctedSession = afterCorrection.find((s) => s.id === yesterday)!;
    expect(correctedSession.checkedOutAt).toBeNull(); // original untouched
    expect(correctedSession.corrections).toHaveLength(1);
    expect(correctedSession.corrections[0]!.reason).toMatch(/forgot to check out/);
  }, 30_000);

  it('an Accountant has no attendance-oversight capability', async () => {
    const accountant = await adminActor(accountantPhone);
    await expect(listAttendance(pool, accountant, { outletId })).rejects.toThrow(/Denied/);
  });

  it('reports a read-only employee activity summary', async () => {
    const owner = await adminActor(ownerPhone);
    const today = new Date().toISOString().slice(0, 10);
    const summary = await getEmployeeActivitySummary(pool, owner, {
      outletId,
      employeeId,
      businessDate: today,
    });
    expect(summary.employeeName).toBe('Attendance Ravi');
    expect(summary.billCount).toBe(0);
  });
});
