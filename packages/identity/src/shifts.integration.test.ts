/**
 * Billing V1 Stage 2 - employee shifts + shared outlet cash session.
 *
 * Only one operator session is active on a terminal at a time (a new PIN login
 * ends the previous one), but multiple employee *shifts* may stay open. Tests
 * therefore re-authenticate whenever they switch employee.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import { issueActivationCode, registerTerminal } from './terminal';
import { checkOut, getOwnOpenAttendance } from './attendance';
import { createEmployee } from './employee';
import {
  pinLogin,
  loadOperatorContext,
  recordStaffAttendance,
  listOutletStaff,
} from './store-auth';
import { listOwnerRegisters, getOwnerRegisterReview, closeOwnerRegister } from './owner-registers';
import {
  openCashSession,
  finishWork,
  closeCashSession,
  getOpenCashSession,
  startShift,
  endShift,
  forceCloseShift,
  listOpenShifts,
  outletBillingWindow,
} from './shifts';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';
const S = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerPhone: string;
let otherOwnerPhone: string;
let franchiseId: string;
let otherFranchiseId: string;
let outletId: string;
let terminalCredential: string;
let pinA: string;
let pinB: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Shift ${role}`, role === 'central_admin'],
  );
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, brand_id, franchise_id)
     values ($1,$2,$3,$4,$5) on conflict do nothing`,
    [rows[0]!.id, role, JKSH_ORG, fId ? TVANAMM_BRAND : null, fId],
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

/** PIN-login (ends any other operator session on the terminal) and return the
 *  operator ActorContext. */
async function loginAs(pin: string): Promise<ActorContext> {
  const res = await pinLogin(pool, { terminalCredential, pin });
  if (res.result.outcome !== 'resolved' || !res.operatorToken) throw new Error('pin login failed');
  const a = await loadOperatorContext(pool, res.operatorToken);
  if (!a) throw new Error('no operator context');
  return a;
}

describe.skipIf(!RUN)('Billing V1 Stage 2 - shifts + cash session', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    adminPhone = `+9194${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9193${S.slice(-8).padStart(8, '0')}`;
    otherOwnerPhone = `+9192${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    otherFranchiseId = randomUUID();
    for (const [id, n] of [
      [franchiseId, `shf-${S}`],
      [otherFranchiseId, `sho-${S}`],
    ] as const) {
      await pool.query(
        `insert into billing.franchises (id, organization_id, brand_id, name, slug)
         values ($1,$2,$3,$4,$5)`,
        [id, JKSH_ORG, TVANAMM_BRAND, n, n],
      );
    }
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);
    await seedAccount(otherOwnerPhone, 'franchise_owner', otherFranchiseId);

    outletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, JKSH_ORG, TVANAMM_BRAND, franchiseId, `ShOut${S.slice(-4)}`, `shout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Shift test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Shift iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;

    pinA = String(4000 + (Date.now() % 3000));
    pinB = String(Number(pinA) === 4999 ? 4998 : Number(pinA) + 1);
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Shift Anita',
      mobile: `+9184${S.slice(-8).padStart(8, '0')}`,
      initialPin: pinA,
    });
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Shift Bala',
      mobile: `+9185${S.slice(-8).padStart(8, '0')}`,
      initialPin: pinB,
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await pool.query(`delete from identity.attendance_sessions where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.cash_sessions where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.employee_shifts where outlet_id = $1`, [outletId]);
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
      await pool.query(`delete from identity.memberships where franchise_id = any($1::uuid[])`, [
        [franchiseId, otherFranchiseId],
      ]);
      await pool.query(`delete from billing.franchises where id = any($1::uuid[])`, [
        [franchiseId, otherFranchiseId],
      ]);
      await pool.query(`delete from identity.account_profiles where mobile = any($1::text[])`, [
        [adminPhone, ownerPhone, otherOwnerPhone],
      ]);
    } catch {
      /* best effort */
    }
    await pool.end();
  });

  it('opens exactly one cash session per outlet', async () => {
    const a = await loginAs(pinA);
    const opened = await openCashSession(pool, a, { openingCash: '1000.00' });
    expect(opened.id).toBeTruthy();
    const b = await loginAs(pinB);
    await expect(openCashSession(pool, b, { openingCash: '500.00' })).rejects.toThrow(
      /already open/,
    );
    const cur = await getOpenCashSession(pool, b, outletId);
    expect(cur?.openingCash).toBe('1000.00');
  });

  it('allows multiple open employee shifts, resuming rather than duplicating', async () => {
    const a = await loginAs(pinA);
    const shifts = await Promise.all(Array.from({ length: 8 }, () => startShift(pool, a, {})));
    const s1 = shifts[0]!;
    expect(new Set(shifts.map((shift) => shift.id)).size).toBe(1);
    const s1again = await startShift(pool, a, {});
    expect(s1again.id).toBe(s1.id); // resume, not a new shift
    const b = await loginAs(pinB);
    const s2 = await startShift(pool, b, {});
    expect(s2.id).not.toBe(s1.id);
    const open = await listOpenShifts(pool, b, outletId);
    expect(open.filter((s) => s.status === 'open')).toHaveLength(2);
  });

  it('closes the cash session; a non-zero variance needs a reason', async () => {
    const a = await loginAs(pinA);
    const cur = await getOpenCashSession(pool, a, outletId);
    const closed = await closeCashSession(pool, a, cur!.id, { countedCash: '1000.00' });
    expect(closed.status).toBe('closed');
    expect(closed.variance).toBe('0.00');
    expect(closed.closedByName).toBe('Shift Anita');

    const b = await loginAs(pinB);
    const reopened = await openCashSession(pool, b, { openingCash: '1000.00' });
    await expect(closeCashSession(pool, b, reopened.id, { countedCash: '900.00' })).rejects.toThrow(
      /reason is required/,
    );
    const ok = await closeCashSession(pool, b, reopened.id, {
      countedCash: '900.00',
      varianceReason: 'till short, investigating',
    });
    expect(ok.variance).toBe('-100.00');
    expect(ok.varianceReason).toContain('investigating');
  });

  it('a settled cash session cannot be modified or reopened', async () => {
    const a = await loginAs(pinA);
    expect(await getOpenCashSession(pool, a, outletId)).toBeNull();
    await expect(
      pool.query(
        `update billing.cash_sessions set counted_cash = '1'
          where outlet_id = $1 and status <> 'open'`,
        [outletId],
      ),
    ).rejects.toThrow(/settled/);
  });

  it('a Franchise Owner force-closes a forgotten shift with a mandatory reason', async () => {
    const owner = await adminActor(ownerPhone);
    const b = await loginAs(pinB);
    const shift = await startShift(pool, b, {});
    const forced = await forceCloseShift(pool, owner, shift.id, { reason: 'left without ending' });
    expect(forced.status).toBe('force_closed');
    expect(forced.forceCloseReason).toBe('left without ending');

    const a = await loginAs(pinA);
    const s2 = await startShift(pool, a, {});
    const otherOwner = await adminActor(otherOwnerPhone);
    await expect(forceCloseShift(pool, otherOwner, s2.id, { reason: 'nope' })).rejects.toThrow(
      /Denied|row-level security|not found/,
    );
    await endShift(pool, await loginAs(pinA), s2.id);
  });

  it('finishes only my shift and attendance while keeping the shared register open', async () => {
    const a = await loginAs(pinA);
    const cash = await openCashSession(pool, a, { openingCash: '500.00' });
    const mine = await startShift(pool, a, {});
    const b = await loginAs(pinB);
    const colleague = await startShift(pool, b, {});
    const current = await loginAs(pinA);
    expect(await finishWork(pool, current)).toEqual({ cashSession: null });
    expect(await getOwnOpenAttendance(pool, current)).toBeNull();
    const open = await listOpenShifts(pool, current, outletId);
    expect(open.some((shift) => shift.id === mine.id)).toBe(false);
    expect(open.some((shift) => shift.id === colleague.id)).toBe(true);
    expect((await getOpenCashSession(pool, current, outletId))?.id).toBe(cash.id);
    await expect(finishWork(pool, current)).resolves.toEqual({ cashSession: null });
    const coworker = await loginAs(pinB);
    expect(await getOwnOpenAttendance(pool, coworker)).not.toBeNull();
    await finishWork(pool, coworker);
  });

  it('closes the register and my work together, rolling back when cash validation fails', async () => {
    const a = await loginAs(pinA);
    const cash = (await getOpenCashSession(pool, a, outletId))!;
    const shift = await startShift(pool, a, {});
    await expect(
      finishWork(pool, a, { sessionId: cash.id, command: { countedCash: '400.00' } }),
    ).rejects.toThrow(/reason is required/);
    expect(await getOwnOpenAttendance(pool, a)).not.toBeNull();
    expect((await listOpenShifts(pool, a, outletId)).some((row) => row.id === shift.id)).toBe(true);
    expect((await getOpenCashSession(pool, a, outletId))?.id).toBe(cash.id);
    const result = await finishWork(pool, a, {
      sessionId: cash.id,
      command: { countedCash: '500.00' },
    });
    expect(result.cashSession?.status).toBe('closed');
    expect(await getOpenCashSession(pool, a, outletId)).toBeNull();
    expect(await getOwnOpenAttendance(pool, a)).toBeNull();
    expect(await listOpenShifts(pool, a, outletId)).toHaveLength(0);
    const retry = await finishWork(pool, a, {
      sessionId: cash.id,
      command: { countedCash: '500.00' },
    });
    expect(retry.cashSession?.id).toBe(cash.id);
  });

  it('checks out a second employee with their PIN and prevents closing over their open work', async () => {
    const b = await loginAs(pinB);
    const cash = await openCashSession(pool, b, { openingCash: '200.00' });
    const bShift = await startShift(pool, b, {});
    const a = await loginAs(pinA);
    const aShift = await startShift(pool, a, {});
    await expect(checkOut(pool, a, {})).rejects.toThrow(/Finish shift/);
    await expect(
      recordStaffAttendance(pool, a, {
        terminalCredential,
        pin: pinA,
        employeeId: a.employeeId!,
        action: 'check-out',
      }),
    ).rejects.toThrow(/Finish shift/);
    await expect(
      finishWork(pool, a, {
        sessionId: cash.id,
        command: { countedCash: '200.00' },
      }),
    ).rejects.toThrow(/Check out/);
    expect((await getOpenCashSession(pool, a, outletId))?.id).toBe(cash.id);
    await expect(endShift(pool, a, bShift.id)).rejects.toThrow(/own shift|not found/);
    await recordStaffAttendance(pool, a, {
      terminalCredential,
      pin: pinB,
      employeeId: b.employeeId!,
      action: 'check-out',
    });
    const staff = await listOutletStaff(pool, a);
    expect(staff.find((person) => person.id === b.employeeId)).toMatchObject({
      checkedIn: false,
      shiftOpen: false,
    });
    expect(staff.find((person) => person.id === a.employeeId)).toMatchObject({
      checkedIn: true,
      shiftOpen: true,
      isCurrentCashier: true,
    });
    expect((await listOpenShifts(pool, a, outletId)).map((shift) => shift.id)).toEqual([aShift.id]);
    const closed = await finishWork(pool, a, {
      sessionId: cash.id,
      command: { countedCash: '200.00' },
    });
    expect(closed.cashSession?.status).toBe('closed');
    expect(await getOwnOpenAttendance(pool, a)).toBeNull();
    expect(await listOpenShifts(pool, a, outletId)).toHaveLength(0);
    const next = await loginAs(pinA);
    expect(await getOwnOpenAttendance(pool, next)).not.toBeNull();
    expect(await getOpenCashSession(pool, next, outletId)).toBeNull();
    await finishWork(pool, next);
  });

  it('requires attendance-only coworkers to check out before final register closing', async () => {
    const b = await loginAs(pinB);
    const a = await loginAs(pinA);
    const cash = await openCashSession(pool, a, { openingCash: '0.00' });
    await expect(
      finishWork(pool, a, { sessionId: cash.id, command: { countedCash: '0.00' } }),
    ).rejects.toThrow(/Check out/);
    await recordStaffAttendance(pool, a, {
      terminalCredential,
      pin: pinB,
      employeeId: b.employeeId!,
      action: 'check-out',
    });
    await finishWork(pool, a, { sessionId: cash.id, command: { countedCash: '0.00' } });
  });

  it('lets the owner close directly and open a fresh register on the same day', async () => {
    const a = await loginAs(pinA);
    const owner = await adminActor(ownerPhone);
    const otherOwner = await adminActor(otherOwnerPhone);
    const cash = await openCashSession(pool, a, { openingCash: '500.00' });
    await startShift(pool, a, {});
    const cmd = {
      countedCash: '490.00',
      expectedCash: '500.00',
      reason: 'Owner verified cash shortage with outlet',
      closeOpenShifts: true,
    };
    expect((await listOwnerRegisters(pool, owner)).some((r) => r.id === cash.id)).toBe(true);
    expect(await listOwnerRegisters(pool, otherOwner)).toHaveLength(0);
    await expect(getOwnerRegisterReview(pool, otherOwner, cash.id)).rejects.toThrow(/not found/i);
    await expect(closeOwnerRegister(pool, otherOwner, cash.id, cmd)).rejects.toThrow(/not found/i);
    await expect(closeOwnerRegister(pool, a, cash.id, cmd)).rejects.toThrow(/franchise owner/);
    await expect(
      closeOwnerRegister(pool, await adminActor(adminPhone), cash.id, cmd),
    ).rejects.toThrow(/franchise owner/);
    await expect(
      closeOwnerRegister(pool, owner, cash.id, { ...cmd, reason: ' ' }),
    ).rejects.toThrow();
    await expect(
      closeOwnerRegister(pool, owner, cash.id, { ...cmd, expectedCash: '499.00' }),
    ).rejects.toThrow(/changed during review/);
    expect((await getOpenCashSession(pool, a, outletId))?.id).toBe(cash.id);
    const result = await closeOwnerRegister(pool, owner, cash.id, cmd);
    expect(result).toMatchObject({ variance: '-10.00', closedShifts: 1 });
    expect(await listOpenShifts(pool, a, outletId)).toHaveLength(0);
    expect(await getOwnOpenAttendance(pool, a)).not.toBeNull();
    const closed = await pool.query(
      'select closed_by_account_id, closed_by_employee_id, status from billing.cash_sessions where id = $1',
      [cash.id],
    );
    expect(closed.rows[0]).toMatchObject({
      closed_by_account_id: owner.accountId,
      closed_by_employee_id: null,
      status: 'closed',
    });
    await expect(closeOwnerRegister(pool, owner, cash.id, cmd)).rejects.toThrow(
      /already.*closed|not found/i,
    );
    const next = await openCashSession(pool, a, { openingCash: '490.00' });
    expect(next.id).not.toBe(cash.id);
    expect(next.businessDate).toBe(cash.businessDate);
    await startShift(pool, a, {});
    expect((await outletBillingWindow(pool, a, outletId)).blocked).toBe(false);
    await finishWork(pool, a, { sessionId: next.id, command: { countedCash: '490.00' } });
  });

  it('owner closing also clears a forgotten prior-day register when auto-close has not run', async () => {
    const a = await loginAs(pinA);
    const owner = await adminActor(ownerPhone);
    const cash = await openCashSession(pool, a, { openingCash: '100.00' });
    await startShift(pool, a, {});
    await pool.query(
      'update billing.cash_sessions set business_date = current_date - 1 where id = $1',
      [cash.id],
    );
    await pool.query(
      "update billing.employee_shifts set business_date = current_date - 1 where outlet_id = $1 and status = 'open'",
      [outletId],
    );
    expect((await outletBillingWindow(pool, a, outletId)).blocked).toBe(true);
    expect((await getOwnerRegisterReview(pool, owner, cash.id)).overdue).toBe(true);
    await closeOwnerRegister(pool, owner, cash.id, {
      countedCash: '100.00',
      expectedCash: '100.00',
      reason: 'Manual fallback for missed midnight closure',
      closeOpenShifts: true,
    });
    expect((await outletBillingWindow(pool, a, outletId)).blocked).toBe(false);
    const next = await openCashSession(pool, a, { openingCash: '100.00' });
    await finishWork(pool, a, { sessionId: next.id, command: { countedCash: '100.00' } });
  });

  it('closes expired registers and shifts at local midnight once, without inventing a cash count', async () => {
    const a = await loginAs(pinA);
    let win = await outletBillingWindow(pool, a, outletId);
    expect(win.blocked).toBe(false);

    const cash = await pool.query<{ id: string; boundary: Date }>(
      `insert into billing.cash_sessions
         (organization_id, franchise_id, outlet_id, business_date, opened_by_employee_id,
          opened_by_name, opening_cash)
       select $1, $2, $3, (current_date - 1), se.id, se.full_name, 500
         from identity.store_employees se where se.outlet_id = $3 limit 1
       returning id, ((business_date + 1)::timestamp at time zone 'Asia/Kolkata') as boundary`,
      [JKSH_ORG, franchiseId, outletId],
    );
    win = await outletBillingWindow(pool, a, outletId);
    expect(win.blocked).toBe(true);
    expect(win.reason).toBe('stale_cash_session');
    const shift = await pool.query<{ id: string }>(
      `insert into billing.employee_shifts
         (organization_id, franchise_id, outlet_id, employee_id, employee_name, business_date)
       values ($1, $2, $3, $4, 'Midnight test', current_date - 1) returning id`,
      [JKSH_ORG, franchiseId, outletId, a.employeeId],
    );
    const session = cash.rows[0]!;
    // Asia/Kolkata midnight is 18:30 UTC, not the database's UTC date boundary.
    expect(session.boundary.toISOString()).toContain('T18:30:00.000Z');
    await pool.query('select billing.close_expired_business_days($1)', [
      new Date(session.boundary.getTime() - 1),
    ]);
    expect((await getOpenCashSession(pool, a, outletId))?.id).toBe(session.id);
    const runs = await Promise.all([
      pool.query('select billing.close_expired_business_days($1) as count', [session.boundary]),
      pool.query('select billing.close_expired_business_days($1) as count', [session.boundary]),
    ]);
    expect(runs.reduce((sum, r) => sum + Number(r.rows[0].count), 0)).toBe(1);
    const closed = await pool.query('select * from billing.cash_sessions where id = $1', [
      session.id,
    ]);
    expect(closed.rows[0]).toMatchObject({
      status: 'force_closed',
      counted_cash: null,
      variance: null,
      expected_cash: '500.00',
      closed_by_employee_id: null,
    });
    const ended = await pool.query('select status from billing.employee_shifts where id = $1', [
      shift.rows[0]!.id,
    ]);
    expect(ended.rows[0].status).toBe('force_closed');
    const audit = await pool.query('select metadata from audit.events where subject_id = $1', [
      session.id,
    ]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({ automatic: true, reconciliationRequired: true });
    expect((await outletBillingWindow(pool, a, outletId)).blocked).toBe(false);

    const current = await openCashSession(pool, a, { openingCash: '100.00' });
    await pool.query('select billing.close_expired_business_days()');
    expect((await getOpenCashSession(pool, a, outletId))?.id).toBe(current.id);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role identity_api');
      await expect(client.query('select billing.close_expired_business_days()')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
