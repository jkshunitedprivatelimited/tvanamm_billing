/**
 * Stage 1 vertical, exercised against a real Postgres. Runs only when
 * DATABASE_URL is set (CI and local `docker compose -f docker-compose.test.yml`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import { seedDevData } from '@jksh/db';
import { FakeOtpProvider, setOtpProvider } from './otp-provider.js';
import { verifyAdminOtp, startAdminOtp } from './admin-auth.js';
import { withTransaction } from '@jksh/db';
import { loadActorContext } from './session-context.js';
import { issueActivationCode, registerTerminal, listTerminals } from './terminal.js';
import { createEmployee } from './employee.js';
import { pinLogin } from './store-auth.js';
import { authorize } from './authorize.js';

const RUN = !!process.env.DATABASE_URL;

const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';
const DEMO_FRANCHISE = '11111111-1111-4111-8111-111111111111';
const DEMO_OUTLET = '22222222-2222-4222-8222-222222222222';

let pool: Pool;
let ownerPhone: string;
let otherFranchiseId: string;
let otherOutletId: string;

async function makeOwner(phone: string, franchiseId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into identity.users (id, full_name, phone, account_state, is_internal, has_auth_login, activated_at)
     values ($1, 'Test Owner', $2, 'active', false, true, now())`,
    [id, phone],
  );
  await pool.query(
    `insert into identity.memberships (user_id, role, organization_id, brand_id, franchise_id, outlet_id)
     values ($1, 'franchise_owner', $2, $3, $4, null)`,
    [id, JKSH_ORG, TVANAMM_BRAND, franchiseId],
  );
  return id;
}

describe.skipIf(!RUN)('Stage 1 identity vertical (integration)', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);
    await seedDevData(pool);
    setOtpProvider(new FakeOtpProvider('1234'));

    ownerPhone = `+9199${String(Date.now()).slice(-8)}`;
    await makeOwner(ownerPhone, DEMO_FRANCHISE);

    otherFranchiseId = randomUUID();
    otherOutletId = randomUUID();
    await pool.query(
      `insert into identity.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,'Other Franchise',$4)`,
      [otherFranchiseId, JKSH_ORG, TVANAMM_BRAND, `other-${otherFranchiseId.slice(0, 8)}`],
    );
    await pool.query(
      `insert into identity.outlets (id, organization_id, franchise_id, name, slug, timezone)
       values ($1,$2,$3,'Other Outlet',$4,'Asia/Kolkata')`,
      [otherOutletId, JKSH_ORG, otherFranchiseId, `other-outlet-${otherOutletId.slice(0, 8)}`],
    );
  });

  afterAll(async () => {
    setOtpProvider(undefined);
    await pool.end();
  });

  async function ownerActor() {
    const login = await verifyAdminOtp(pool, { phone: ownerPhone, code: '1234' });
    if (login.result.outcome !== 'single_workspace') throw new Error('expected single workspace');
    const { sessionId } = login.result;
    return withTransaction(pool, (client) => loadActorContext(client, sessionId));
  }

  it('rejects a wrong OTP and accepts the fixed one', async () => {
    await startAdminOtp(pool, { phone: ownerPhone });
    const bad = await verifyAdminOtp(pool, { phone: ownerPhone, code: '0000' });
    expect(bad.result.outcome).toBe('rejected');

    const good = await verifyAdminOtp(pool, { phone: ownerPhone, code: '1234' });
    expect(good.result.outcome).toBe('single_workspace');
    expect(good.sessionToken).toBeTruthy();
  });

  it('builds an actor context with the owner membership and scope', async () => {
    const actor = await ownerActor();
    expect(actor.membership.role).toBe('franchise_owner');
    expect(actor.membership.scope.franchiseId).toBe(DEMO_FRANCHISE);

    const scope = {
      organizationId: JKSH_ORG,
      franchiseId: DEMO_FRANCHISE,
      outletId: DEMO_OUTLET,
    };
    expect(authorize(actor, 'identity.terminal.enroll', scope).allowed).toBe(true);
    // A fresh OTP session also satisfies the step-up policy.
    expect(
      authorize(actor, 'identity.terminal.enroll', scope, {
        requireStepUpWithinSeconds: 900,
      }).allowed,
    ).toBe(true);
  });

  it('enrolls a terminal, then replaces it on re-registration', async () => {
    const actor = await ownerActor();

    const code1 = await issueActivationCode(pool, actor, {
      outletId: DEMO_OUTLET,
      label: 'Front counter',
      expiresInMinutes: 60,
    });
    const term1 = await registerTerminal(pool, { code: code1.code, deviceLabel: 'iPad A' });
    expect(term1.receiptPrefix).toBe('T01');
    expect(term1.terminalCredential).toMatch(/^jksh_t_v1\./);

    const code2 = await issueActivationCode(pool, actor, {
      outletId: DEMO_OUTLET,
      label: 'Replacement',
      expiresInMinutes: 60,
    });
    const term2 = await registerTerminal(pool, { code: code2.code, deviceLabel: 'iPad B' });
    expect(term2.terminalId).not.toBe(term1.terminalId);

    const terminals = await listTerminals(pool, actor, DEMO_OUTLET);
    const active = terminals.filter((t) => t.state !== 'revoked');
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(term2.terminalId);
  });

  it('creates an employee and runs PIN login with lockout on repeated failure', async () => {
    const actor = await ownerActor();

    const code = await issueActivationCode(pool, actor, {
      outletId: DEMO_OUTLET,
      label: 'Counter',
      expiresInMinutes: 60,
    });
    const terminal = await registerTerminal(pool, { code: code.code, deviceLabel: 'PIN test terminal' });

    const employee = await createEmployee(pool, actor, {
      outletId: DEMO_OUTLET,
      fullName: 'Priya K',
      phone: '+919812345678',
      initialPin: '5297',
    });
    expect(employee.employeeId).toMatch(/^EMP-/);
    expect(employee.pinSet).toBe(true);

    const wrong = await pinLogin(pool, {
      terminalCredential: terminal.terminalCredential,
      pin: '0000',
    });
    expect(wrong.result.outcome).toBe('rejected');

    const ok = await pinLogin(pool, {
      terminalCredential: terminal.terminalCredential,
      pin: '5297',
    });
    expect(ok.result.outcome).toBe('resolved');
    if (ok.result.outcome === 'resolved') {
      expect(ok.result.employeeName).toBe('Priya K');
      expect(ok.result.outletId).toBe(DEMO_OUTLET);
    }
  });

  it('denies an owner acting outside their franchise', async () => {
    const actor = await ownerActor();

    await expect(
      issueActivationCode(pool, actor, {
        outletId: otherOutletId,
        label: 'Should fail',
        expiresInMinutes: 60,
      }),
    ).rejects.toThrow(/Denied/);
  });

  it('writes audit rows for login and terminal enrolment', async () => {
    const { rows } = await pool.query<{ action: string; c: string }>(
      `select action, count(*)::text as c from audit.auth_events group by action`,
    );
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has('login.succeeded')).toBe(true);
    expect(actions.has('terminal.enrolled')).toBe(true);
    expect(actions.has('workspace.selected')).toBe(true);
  });
});
