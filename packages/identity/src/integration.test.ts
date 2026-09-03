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
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth.js';
import { createOutlet, outletLifecycle, listOutlets } from './outlet.js';
import { issueActivationCode, registerTerminal, listTerminals } from './terminal.js';
import { createEmployee, setEmployeeStatus } from './employee.js';
import { pinLogin } from './store-auth.js';
import { authorize } from './authorize.js';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';
const SUFFIX = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerPhone: string;
let runFranchiseId: string;
let runOutletId: string;

async function seedAccount(phone: string, role: string, franchiseId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, activated_at)
     values ($1,$2,'active',now())
     on conflict (mobile) do update set status = 'active' returning id`,
    [phone, `Test ${role}`],
  );
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, franchise_id)
     values ($1,$2,$3,$4) on conflict do nothing`,
    [rows[0]!.id, role, JKSH_ORG, franchiseId],
  );
}

async function actorFor(phone: string): Promise<ActorContext> {
  const authUserId = randomUUID();
  const resolved = await resolveAdminAfterVerify(pool, { authUserId, phone });
  if (resolved.result.outcome !== 'single_workspace') throw new Error('expected single workspace');
  const actor = await buildAdminActor(pool, {
    authUserId,
    membershipId: resolved.result.membershipId,
    secondsSinceAuth: 5,
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
    await pool.end();
  });

  it('rejects an OTP for a phone with no account', async () => {
    const r = await resolveAdminAfterVerify(pool, { authUserId: randomUUID(), phone: '+919999999999' });
    expect(r.result.outcome).toBe('rejected');
  });

  it('resolves a central admin and grants outlet.create but not sale.create', async () => {
    const actor = await actorFor(adminPhone);
    expect(actor.role).toBe('central_admin');
    expect(authorize(actor, 'billing.outlet.create', { organizationId: JKSH_ORG }).allowed).toBe(true);
    expect(authorize(actor, 'billing.sale.create', { organizationId: JKSH_ORG }).allowed).toBe(false);
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

    expect((await pinLogin(pool, { terminalCredential: term.terminalCredential, pin: '0000' })).result.outcome).toBe('rejected');

    const ok = await pinLogin(pool, { terminalCredential: term.terminalCredential, pin });
    expect(ok.result.outcome).toBe('resolved');
    if (ok.result.outcome === 'resolved') {
      expect(ok.result.employeeName).toBe('Priya K');
      expect(ok.result.outletId).toBe(runOutletId);
    }

    await setEmployeeStatus(pool, owner, emp.employeeId, { status: 'disabled' });
    expect((await pinLogin(pool, { terminalCredential: term.terminalCredential, pin })).result.outcome).toBe('rejected');
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

  it('scopes outlet listing by tenant', async () => {
    const admin = await actorFor(adminPhone);
    const owner = await actorFor(ownerPhone);
    const adminOutlets = await listOutlets(pool, admin);
    const ownerOutlets = await listOutlets(pool, owner);
    expect(adminOutlets.length).toBeGreaterThan(ownerOutlets.length);
    expect(ownerOutlets.every((o) => o.franchiseId === runFranchiseId)).toBe(true);
  });

  it('writes audit rows for login, outlet, and terminal actions', async () => {
    const { rows } = await pool.query<{ action: string }>(`select distinct action from audit.events`);
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has('login.succeeded')).toBe(true);
    expect(actions.has('outlet.created')).toBe(true);
    expect(actions.has('terminal.enrolled')).toBe(true);
  });
});
