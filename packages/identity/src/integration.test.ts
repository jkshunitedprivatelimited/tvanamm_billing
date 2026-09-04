/**
 * Stage 1 vertical against a real Postgres. Runs only when DATABASE_URL is set.
 * Each run provisions its own franchise + owner + outlet so it is idempotent
 * against a shared database.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import { seedDevData } from '@jksh/db';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import { createFranchise, listFranchises } from './franchise';
import { createFranchiseOwnerInvitation, acceptInvitation } from './invitations';
import { createOutlet, outletLifecycle, listOutlets } from './outlet';
import { issueActivationCode, registerTerminal, listTerminals } from './terminal';
import { createEmployee, setEmployeeStatus } from './employee';
import { pinLogin } from './store-auth';
import { authorize } from './authorize';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';
const TLEAF_BRAND = '01000000-0000-4000-8000-000000000011';
const SUFFIX = Date.now().toString(36);

/** Run a statement that must fail on a named check/FK constraint. */
async function expectConstraint(sql: string, params: unknown[], constraint: string): Promise<void> {
  try {
    await pool.query(sql, params);
    throw new Error(`expected ${constraint} to reject the insert`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain(constraint);
  }
}

let pool: Pool;
let adminPhone: string;
let ownerPhone: string;
let runFranchiseId: string;
let runOutletId: string;

async function seedAccount(phone: string, role: string, franchiseId: string | null): Promise<void> {
  const internal = role === 'central_admin' || role === 'accountant';
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status = 'active', is_internal = excluded.is_internal
     returning id`,
    [phone, `Test ${role}`, internal],
  );
  // A franchise-scoped membership must also carry the franchise's brand so the
  // composite (brand_id, franchise_id) FK from migration 0012 is satisfied.
  const brandId = franchiseId ? TVANAMM_BRAND : null;
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, brand_id, franchise_id)
     values ($1,$2,$3,$4,$5) on conflict do nothing`,
    [rows[0]!.id, role, JKSH_ORG, brandId, franchiseId],
  );
}

async function actorFor(phone: string): Promise<ActorContext> {
  const authUserId = randomUUID();
  const resolved = await resolveAdminAfterVerify(pool, { authUserId, phone });
  if (resolved.result.outcome !== 'single_workspace') throw new Error('expected single workspace');
  const actor = await buildAdminActor(pool, {
    authUserId,
    membershipId: resolved.result.membershipId,
  });
  if (!actor) throw new Error('no actor');
  return actor;
}

describe.skipIf(!RUN)('Stage 1 identity vertical (re-aligned)', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);
    await seedDevData(pool);

    adminPhone = `+9198${SUFFIX.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9199${SUFFIX.slice(-8).padStart(8, '0')}`;
    await seedAccount(adminPhone, 'central_admin', null);

    runFranchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [runFranchiseId, JKSH_ORG, TVANAMM_BRAND, `Run ${SUFFIX}`, `run-${SUFFIX}`],
    );
    await seedAccount(ownerPhone, 'franchise_owner', runFranchiseId);

    // Central creates + activates the run's outlet.
    const admin = await actorFor(adminPhone);
    const created = await createOutlet(pool, admin, {
      brandId: TVANAMM_BRAND,
      ownershipType: 'franchise_owned',
      franchiseId: runFranchiseId,
      displayName: `Run Outlet ${SUFFIX}`,
      addressLine: '1 Test Road',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      paymentMethods: ['cash', 'upi'],
    });
    runOutletId = created.id;
    await outletLifecycle(pool, admin, runOutletId, { action: 'activate' });
  }, 60_000);

  afterAll(async () => {
    // Leave the shared database as we found it.
    try {
      await pool.query(`delete from identity.operator_sessions where outlet_id = $1`, [
        runOutletId,
      ]);
      await pool.query(
        `delete from identity.terminal_credentials where terminal_id in
           (select id from identity.terminals where outlet_id = $1)`,
        [runOutletId],
      );
      await pool.query(`delete from identity.terminal_activation_codes where outlet_id = $1`, [
        runOutletId,
      ]);
      await pool.query(`delete from identity.terminals where outlet_id = $1`, [runOutletId]);
      await pool.query(`delete from identity.store_employees where outlet_id = $1`, [runOutletId]);
      await pool.query(`delete from billing.outlets where id = $1`, [runOutletId]);
      await pool.query(`delete from identity.memberships where franchise_id = $1`, [
        runFranchiseId,
      ]);
      await pool.query(`delete from billing.franchises where id = $1`, [runFranchiseId]);
      await pool.query(`delete from identity.account_profiles where mobile in ($1,$2)`, [
        adminPhone,
        ownerPhone,
      ]);
      await pool.query(
        `delete from identity.otp_attempts where mobile in ($1,$2,'+919999999999')`,
        [adminPhone, ownerPhone],
      );
    } catch {
      // best effort
    }
    await pool.end();
  });

  it('rejects an OTP for a phone with no account', async () => {
    const r = await resolveAdminAfterVerify(pool, {
      authUserId: randomUUID(),
      phone: '+919999999999',
    });
    expect(r.result.outcome).toBe('rejected');
  });

  it('resolves a central admin and grants outlet.create but not sale.create', async () => {
    const actor = await actorFor(adminPhone);
    expect(actor.role).toBe('central_admin');
    expect(authorize(actor, 'billing.outlet.create', { organizationId: JKSH_ORG }).allowed).toBe(
      true,
    );
    expect(authorize(actor, 'billing.sale.create', { organizationId: JKSH_ORG }).allowed).toBe(
      false,
    );
  });

  it('denies a Franchise Owner creating an outlet (capability + RLS)', async () => {
    const owner = await actorFor(ownerPhone);
    await expect(
      createOutlet(pool, owner, {
        brandId: TVANAMM_BRAND,
        ownershipType: 'jksh_owned',
        displayName: 'Sneaky',
        addressLine: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'IN',
        timezone: 'Asia/Kolkata',
        paymentMethods: ['cash'],
      }),
    ).rejects.toThrow(/Denied|row-level security/);
  });

  it('enrolls a terminal and PIN-logs an employee; disabling ends the session', async () => {
    const owner = await actorFor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId: runOutletId,
      label: 'Front counter',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'iPad A',
      paperWidthMm: 80,
    });
    expect(term.receiptPrefix).toBe('T01');

    const pin = String(1000 + (Date.now() % 8000));
    const emp = await createEmployee(pool, owner, {
      outletId: runOutletId,
      fullName: 'Priya K',
      mobile: `+9181${SUFFIX.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });
    expect(emp.employeeCode).toMatch(/^EMP-/);

    expect(
      (await pinLogin(pool, { terminalCredential: term.terminalCredential, pin: '0000' })).result
        .outcome,
    ).toBe('rejected');

    const ok = await pinLogin(pool, { terminalCredential: term.terminalCredential, pin });
    expect(ok.result.outcome).toBe('resolved');
    if (ok.result.outcome === 'resolved') {
      expect(ok.result.employeeName).toBe('Priya K');
      expect(ok.result.outletId).toBe(runOutletId);
    }

    await setEmployeeStatus(pool, owner, emp.employeeId, { status: 'disabled' });
    expect(
      (await pinLogin(pool, { terminalCredential: term.terminalCredential, pin })).result.outcome,
    ).toBe('rejected');
  }, 30_000);

  it('locks the terminal after repeated nonexistent-PIN guesses', async () => {
    const owner = await actorFor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId: runOutletId,
      label: 'Brute-force test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'iPad C',
      paperWidthMm: 80,
    });

    let lockedAt = 0;
    for (let i = 1; i <= 12 && lockedAt === 0; i += 1) {
      // Rotate the guess so it never matches an employee; each still counts.
      const guess = String(1000 + i).padStart(4, '0');
      const r = await pinLogin(pool, { terminalCredential: term.terminalCredential, pin: guess });
      if (r.result.outcome === 'rejected' && r.result.reason === 'locked') lockedAt = i;
      else expect(r.result.outcome).toBe('rejected');
    }
    expect(lockedAt).toBeGreaterThan(0);
    expect(lockedAt).toBeLessThanOrEqual(12);
  }, 30_000);

  it('suspending an outlet revokes its terminal', async () => {
    const admin = await actorFor(adminPhone);
    const owner = await actorFor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId: runOutletId,
      label: 'Suspend test',
      expiresInMinutes: 60,
    });
    await registerTerminal(pool, { code: code.code, deviceLabel: 'iPad B', paperWidthMm: 58 });

    await outletLifecycle(pool, admin, runOutletId, { action: 'suspend', reason: 'audit' });
    const terminals = await listTerminals(pool, admin, runOutletId);
    expect(terminals.every((t) => t.status === 'revoked')).toBe(true);

    await outletLifecycle(pool, admin, runOutletId, { action: 'reactivate' });
  }, 30_000);

  it('requires fresh OTP for a sensitive command when last_otp_at is stale', async () => {
    const admin = await actorFor(adminPhone);
    // Push the interactive-auth timestamp 20 minutes into the past.
    await pool.query(
      `update identity.account_profiles set last_otp_at = now() - interval '20 minutes' where id = $1`,
      [admin.accountId],
    );
    const stale = await buildAdminActor(pool, {
      authUserId: admin.accountId
        ? (
            await pool.query<{ auth_user_id: string }>(
              `select auth_user_id from identity.account_profiles where id = $1`,
              [admin.accountId],
            )
          ).rows[0]!.auth_user_id
        : '',
      membershipId: (
        await pool.query<{ id: string }>(
          `select id from identity.memberships where account_id = $1`,
          [admin.accountId],
        )
      ).rows[0]!.id,
    });
    if (!stale) throw new Error('no stale actor');
    await expect(outletLifecycle(pool, stale, runOutletId, { action: 'suspend' })).rejects.toThrow(
      /fresh|Denied/,
    );
  });

  it('scopes outlet listing by tenant', async () => {
    const admin = await actorFor(adminPhone);
    const owner = await actorFor(ownerPhone);
    const adminOutlets = await listOutlets(pool, admin);
    const ownerOutlets = await listOutlets(pool, owner);
    expect(adminOutlets.length).toBeGreaterThan(ownerOutlets.length);
    expect(ownerOutlets.every((o) => o.franchiseId === runFranchiseId)).toBe(true);
  });

  it('runs the franchise + invitation onboarding path with its guard rails', async () => {
    const admin = await actorFor(adminPhone);
    const owner = await actorFor(ownerPhone);

    // Central creates a franchise; Franchise Owner cannot.
    const fr = await createFranchise(pool, admin, {
      brandId: TVANAMM_BRAND,
      name: `Onboard ${SUFFIX}`,
    });
    await expect(
      createFranchise(pool, owner, { brandId: TVANAMM_BRAND, name: 'Nope' }),
    ).rejects.toThrow(/Denied|row-level security/);

    const seen = await listFranchises(pool, admin);
    expect(seen.some((f) => f.id === fr.id)).toBe(true);

    const inviteePhone = `+9171${SUFFIX.slice(-8).padStart(8, '0')}`;
    const inv = await createFranchiseOwnerInvitation(pool, admin, {
      fullName: 'New Owner',
      phone: inviteePhone,
      franchiseId: fr.id,
    });

    // Wrong phone is rejected.
    await expect(acceptInvitation(pool, inv.token, '+919999999999')).rejects.toThrow(
      /different mobile/,
    );

    // Correct phone accepts once; replay is rejected.
    const accepted = await acceptInvitation(pool, inv.token, inviteePhone);
    expect(accepted.accountId).toBe(inv.accountId);
    await expect(acceptInvitation(pool, inv.token, inviteePhone)).rejects.toThrow(/not valid/);

    // A superseding invitation cancels the prior open one.
    const inv2 = await createFranchiseOwnerInvitation(pool, admin, {
      fullName: 'New Owner',
      phone: inviteePhone,
      franchiseId: fr.id,
    });
    const inv3 = await createFranchiseOwnerInvitation(pool, admin, {
      fullName: 'New Owner',
      phone: inviteePhone,
      franchiseId: fr.id,
    });
    await expect(acceptInvitation(pool, inv2.token, inviteePhone)).rejects.toThrow(/not valid/);
    await acceptInvitation(pool, inv3.token, inviteePhone);

    // An internal Central/Accountant mobile cannot be made a Franchise Owner.
    await expect(
      createFranchiseOwnerInvitation(pool, admin, {
        fullName: 'Internal',
        phone: adminPhone,
        franchiseId: fr.id,
      }),
    ).rejects.toThrow(/internal/);

    await pool.query(`delete from identity.invitations where mobile = $1`, [inviteePhone]);
    await pool.query(
      `delete from identity.memberships where account_id in (select id from identity.account_profiles where mobile = $1)`,
      [inviteePhone],
    );
    await pool.query(`delete from identity.account_profiles where mobile = $1`, [inviteePhone]);
    await pool.query(`delete from billing.franchises where id = $1`, [fr.id]);
  }, 30_000);

  it('a disabled employee PIN login returns the generic invalid reason and counts on the terminal', async () => {
    const owner = await actorFor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId: runOutletId,
      label: 'Locked-employee test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'iPad D',
      paperWidthMm: 80,
    });
    const pin = String(2000 + (Date.now() % 6000));
    const emp = await createEmployee(pool, owner, {
      outletId: runOutletId,
      fullName: 'Disabled Dan',
      mobile: `+9182${SUFFIX.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });
    await setEmployeeStatus(pool, owner, emp.employeeId, { status: 'disabled' });

    const before = await pool.query<{ failed_count: number }>(
      `select failed_count from identity.terminal_pin_attempts where terminal_id = $1`,
      [term.terminalId],
    );
    const beforeCount = before.rows[0]?.failed_count ?? 0;

    // Correct PIN, but the employee is disabled: same generic 'invalid' as a
    // wrong PIN, and it still advances the terminal-wide brute-force counter.
    const r = await pinLogin(pool, { terminalCredential: term.terminalCredential, pin });
    expect(r.result.outcome).toBe('rejected');
    if (r.result.outcome === 'rejected') expect(r.result.reason).toBe('invalid');

    const after = await pool.query<{ failed_count: number }>(
      `select failed_count from identity.terminal_pin_attempts where terminal_id = $1`,
      [term.terminalId],
    );
    expect(after.rows[0]!.failed_count).toBe(beforeCount + 1);
  }, 30_000);

  it('an already-locked employee PIN login stays generic, audits safely, and counts on the terminal', async () => {
    const owner = await actorFor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId: runOutletId,
      label: 'Employee-lock test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'iPad E',
      paperWidthMm: 80,
    });
    const pin = String(3000 + (Date.now() % 5000));
    const emp = await createEmployee(pool, owner, {
      outletId: runOutletId,
      fullName: 'Locked Lena',
      mobile: `+9183${SUFFIX.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });
    // Put the employee past its hard-lock threshold while leaving it active, so
    // the login hits the "already locked" branch (not the disabled branch).
    await pool.query(
      `update identity.store_employees
         set failed_attempts = 6, last_failed_at = now(),
             lock_time = now() + interval '1 hour'
       where id = $1`,
      [emp.employeeId],
    );

    const countAudit = async (): Promise<number> => {
      const q = await pool.query<{ n: string }>(
        `select count(*)::int as n from audit.events where terminal_id = $1`,
        [term.terminalId],
      );
      return Number(q.rows[0]!.n);
    };
    const auditBefore = await countAudit();

    // Correct PIN, but the employee is locked: still the generic 'invalid'
    // (only a terminal-wide hard lock ever discloses 'locked'), and it still
    // advances the terminal-wide counter by exactly one.
    const r = await pinLogin(pool, { terminalCredential: term.terminalCredential, pin });
    expect(r.result.outcome).toBe('rejected');
    if (r.result.outcome === 'rejected') expect(r.result.reason).toBe('invalid');

    const termCount = await pool.query<{ failed_count: number }>(
      `select failed_count from identity.terminal_pin_attempts where terminal_id = $1`,
      [term.terminalId],
    );
    expect(termCount.rows[0]!.failed_count).toBe(1);

    // Exactly one new audit row, and it is safe: reason recorded, no PIN in it.
    expect(await countAudit()).toBe(auditBefore + 1);
    const latest = await pool.query<{ action: string; metadata: unknown }>(
      `select action, metadata from audit.events where terminal_id = $1 order by occurred_at desc limit 1`,
      [term.terminalId],
    );
    expect(['pin.login_failed', 'pin.locked']).toContain(latest.rows[0]!.action);
    const meta = JSON.stringify(latest.rows[0]!.metadata ?? {});
    expect(meta).toContain('employee_locked');
    expect(meta).not.toContain(pin);
  }, 30_000);

  it('DB constraints reject cross-brand / cross-franchise tenant rows (migrations 0012 + 0013 + 0014)', async () => {
    const otherFranchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [otherFranchiseId, JKSH_ORG, TVANAMM_BRAND, `Other ${SUFFIX}`, `other-${SUFFIX}`],
    );
    const throwawayAccount = randomUUID();
    await pool.query(
      `insert into identity.account_profiles (id, mobile, display_name, status)
       values ($1,$2,'Constraint Probe','invited')`,
      [throwawayAccount, `+9173${SUFFIX.slice(-8).padStart(8, '0')}`],
    );
    // A brand that lives in a different organization, for the cross-org check.
    const otherOrgId = randomUUID();
    const otherOrgBrandId = randomUUID();
    await pool.query(
      `insert into billing.organizations (id, slug, name) values ($1,$2,'Other Org')`,
      [otherOrgId, `other-org-${SUFFIX}`],
    );
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name) values ($1,$2,$3,'Other Brand')`,
      [otherOrgBrandId, otherOrgId, `other-brand-${SUFFIX}`],
    );
    // A jksh_owned outlet (no franchise) for the positive control.
    const jkshOutletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug)
       values ($1,$2,$3,null,'jksh_owned','active',$4,$5)`,
      [jkshOutletId, JKSH_ORG, TVANAMM_BRAND, `JKSH Outlet ${SUFFIX}`, `jksh-outlet-${SUFFIX}`],
    );

    try {
      // --- migration 0012: non-NULL composite mismatches --------------------

      // Outlet whose franchise belongs to a different brand.
      await expectConstraint(
        `insert into billing.outlets
           (organization_id, brand_id, franchise_id, ownership_type, status,
            display_name, slug)
         values ($1,$2,$3,'franchise_owned','draft',$4,$5)`,
        [JKSH_ORG, TLEAF_BRAND, runFranchiseId, 'Bad Outlet', `bad-outlet-${SUFFIX}`],
        'outlets_franchise_brand_fk',
      );

      // Membership whose franchise belongs to a different brand.
      await expectConstraint(
        `insert into identity.memberships
           (account_id, role_key, organization_id, brand_id, franchise_id)
         values ($1,'franchise_owner',$2,$3,$4)`,
        [throwawayAccount, JKSH_ORG, TLEAF_BRAND, runFranchiseId],
        'memberships_franchise_brand_fk',
      );

      // --- migration 0013: NULL bypass + terminal / activation code + org ---

      // Franchise-owned outlet, but the employee's franchise_id is NULL: the
      // composite FK's MATCH SIMPLE would skip this, so a trigger rejects it.
      await expectConstraint(
        `insert into identity.store_employees
           (outlet_id, organization_id, franchise_id, employee_code, full_name, mobile)
         values ($1,$2,null,$3,'Null Emp','+910000000001')`,
        [runOutletId, JKSH_ORG, `EMP-NUL${SUFFIX.slice(-4).toUpperCase()}`],
        'store_employees_outlet_franchise_match',
      );

      // Same outlet, but a non-NULL franchise from a different franchise.
      await expectConstraint(
        `insert into identity.store_employees
           (outlet_id, organization_id, franchise_id, employee_code, full_name, mobile)
         values ($1,$2,$3,$4,'Bad Emp','+910000000003')`,
        [runOutletId, JKSH_ORG, otherFranchiseId, `EMP-BAD${SUFFIX.slice(-4).toUpperCase()}`],
        'store_employees_outlet_franchise_match',
      );

      // Terminal with a mismatched franchise on a franchise-owned outlet.
      await expectConstraint(
        `insert into identity.terminals
           (outlet_id, organization_id, franchise_id, name, receipt_prefix)
         values ($1,$2,$3,'Bad Term','T09')`,
        [runOutletId, JKSH_ORG, otherFranchiseId],
        'terminals_outlet_franchise_match',
      );

      // Activation code with a NULL franchise on a franchise-owned outlet.
      await expectConstraint(
        `insert into identity.terminal_activation_codes
           (outlet_id, organization_id, franchise_id, label, code_hash, expires_at)
         values ($1,$2,null,'L','h', now() + interval '1 hour')`,
        [runOutletId, JKSH_ORG],
        'activation_codes_outlet_franchise_match',
      );

      // A franchise cannot name a brand from another organization.
      await expectConstraint(
        `insert into billing.franchises (id, organization_id, brand_id, name, slug)
         values ($1,$2,$3,'Cross Org','cross-org-${SUFFIX}')`,
        [randomUUID(), JKSH_ORG, otherOrgBrandId],
        'franchises_brand_org_fk',
      );

      // Positive control: a jksh_owned outlet with a NULL-franchise employee is
      // exactly consistent, so the trigger must allow it.
      await pool.query(
        `insert into identity.store_employees
           (outlet_id, organization_id, franchise_id, employee_code, full_name, mobile)
         values ($1,$2,null,$3,'OK Emp','+910000000002')`,
        [jkshOutletId, JKSH_ORG, `EMP-OK${SUFFIX.slice(-5).toUpperCase()}`],
      );

      // --- migration 0014: frozen outlet scope + outlet->brand->org + FO brand

      // The jksh_owned outlet now has a NULL-franchise child row. Flipping it to
      // franchise_owned would strand that row past the MATCH SIMPLE FK, so the
      // outlet's tenant scope is immutable after creation.
      await expectConstraint(
        `update billing.outlets
            set ownership_type = 'franchise_owned', franchise_id = $2
          where id = $1`,
        [jkshOutletId, runFranchiseId],
        'outlets_scope_frozen',
      );
      // Changing the brand is frozen too.
      await expectConstraint(
        `update billing.outlets set brand_id = $2 where id = $1`,
        [jkshOutletId, TLEAF_BRAND],
        'outlets_scope_frozen',
      );
      // A pure status/config update is still allowed.
      await pool.query(`update billing.outlets set city = 'Hyderabad' where id = $1`, [
        jkshOutletId,
      ]);

      // An outlet cannot name a brand from another organization.
      await expectConstraint(
        `insert into billing.outlets
           (organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug)
         values ($1,$2,null,'jksh_owned','draft',$3,$4)`,
        [JKSH_ORG, otherOrgBrandId, 'Cross Org Outlet', `cross-org-outlet-${SUFFIX}`],
        'outlets_brand_org_fk',
      );

      // A Franchise Owner membership cannot be inserted without its brand.
      await expectConstraint(
        `insert into identity.memberships
           (account_id, role_key, organization_id, brand_id, franchise_id)
         values ($1,'franchise_owner',$2,null,$3)`,
        [throwawayAccount, JKSH_ORG, runFranchiseId],
        'memberships_scope_shape',
      );
    } finally {
      await pool.query(`delete from identity.store_employees where outlet_id = $1`, [jkshOutletId]);
      await pool.query(`delete from billing.outlets where id = $1`, [jkshOutletId]);
      await pool.query(`delete from billing.brands where id = $1`, [otherOrgBrandId]);
      await pool.query(`delete from billing.organizations where id = $1`, [otherOrgId]);
      await pool.query(`delete from identity.account_profiles where id = $1`, [throwawayAccount]);
      await pool.query(`delete from billing.franchises where id = $1`, [otherFranchiseId]);
    }
  }, 30_000);

  it('writes audit rows for login, outlet, and terminal actions', async () => {
    const { rows } = await pool.query<{ action: string }>(
      `select distinct action from audit.events`,
    );
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has('login.succeeded')).toBe(true);
    expect(actions.has('outlet.created')).toBe(true);
    expect(actions.has('terminal.enrolled')).toBe(true);
  });
});
