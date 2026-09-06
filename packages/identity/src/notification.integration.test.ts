/**
 * Operational notifications - emission from a committed event, dedup
 * grouping, role/scope visibility, read/resolve counters, and mandatory
 * categories that cannot be muted (`operational-notifications.md`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import { issueActivationCode, registerTerminal } from './terminal';
import { createEmployee } from './employee';
import { pinLogin, loadOperatorContext } from './store-auth';
import { openCashSession } from './shifts';
import { recordExpense } from './expense';
import {
  emitNotification,
  listNotifications,
  markNotification,
  markAllNotificationsRead,
  setNotificationMute,
} from './notification';

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

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Notif ${role}`, role === 'central_admin' || role === 'accountant'],
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

describe.skipIf(!RUN)('Operational notifications', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Notif Test Brand', true)`,
      [brand, JKSH_ORG, `notif-brand-${S}`],
    );
    adminPhone = `+9173${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9174${S.slice(-8).padStart(8, '0')}`;
    accountantPhone = `+9175${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `notif-${S}`, `notif-${S}`],
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
      [outletId, JKSH_ORG, brand, franchiseId, `NotifOut${S.slice(-4)}`, `notifout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Notif test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Notif iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    pin = String(4173 + (Date.now() % 800));
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Notif Ravi',
      mobile: `+9176${S.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await pool.query(
        `delete from identity.notifications where organization_id = $1 and dedup_key like $2`,
        [JKSH_ORG, `%${S}%`],
      );
      await pool.query(`delete from identity.notifications where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.outlet_expenses where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.expense_config where organization_id = $1`, [JKSH_ORG]);
      await pool.query(`delete from billing.cash_sessions where outlet_id = $1`, [outletId]);
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

  it('a recorded expense emits an owner notification the Accountant cannot see', async () => {
    const op = await operator();
    await openCashSession(pool, op, { openingCash: '1000.00' });
    await recordExpense(pool, op, {
      idempotencyKey: `idem-notif-${S}-1`,
      outletId,
      categoryName: 'Repairs',
      amount: '9000.00',
      paymentSource: 'shared_cash_drawer',
      reason: 'ac repair',
    });

    const owner = await adminActor(ownerPhone);
    const ownerList = await listNotifications(pool, owner, {});
    const expNotif = ownerList.notifications.find((n) => n.category === 'expenses');
    expect(expNotif).toBeDefined();
    expect(expNotif!.severity).toBe('warning'); // over the 5000 default threshold
    expect(ownerList.unreadCount).toBeGreaterThanOrEqual(1);

    // The franchise-scoped notification is not visible to a Central Accountant.
    const accountant = await adminActor(accountantPhone);
    const acctList = await listNotifications(pool, accountant, {});
    expect(acctList.notifications.some((n) => n.id === expNotif!.id)).toBe(false);
  }, 30_000);

  it('repeated emissions with the same dedup key group into one row', async () => {
    const owner = await adminActor(ownerPhone);
    const key = `dedup-test-${S}`;
    for (let i = 0; i < 3; i += 1) {
      await emitNotification(pool, {
        organizationId: JKSH_ORG,
        franchiseId,
        outletId,
        recipientRole: 'franchise_owner',
        category: 'workforce',
        severity: 'info',
        title: `event ${String(i)}`,
        dedupKey: key,
      });
    }
    const list = await listNotifications(pool, owner, {});
    const grouped = list.notifications.filter((n) => n.title.startsWith('event '));
    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.eventCount).toBe(3);
  });

  it('read / resolve / read-all reconcile the unread counter', async () => {
    const owner = await adminActor(ownerPhone);
    const before = await listNotifications(pool, owner, {});
    expect(before.unreadCount).toBeGreaterThan(0);
    const first = before.notifications[0]!;
    await markNotification(pool, owner, first.id, 'read');
    const afterRead = await listNotifications(pool, owner, {});
    expect(afterRead.unreadCount).toBe(before.unreadCount - 1);

    await markNotification(pool, owner, first.id, 'resolved');
    const afterResolve = await listNotifications(pool, owner, {});
    expect(afterResolve.notifications.find((n) => n.id === first.id)?.resolvedAt).not.toBeNull();

    await markAllNotificationsRead(pool, owner);
    expect((await listNotifications(pool, owner, {})).unreadCount).toBe(0);
  }, 30_000);

  it('a mandatory category cannot be muted', async () => {
    const owner = await adminActor(ownerPhone);
    await expect(setNotificationMute(pool, owner, 'security', true)).rejects.toThrow(
      /cannot be muted/i,
    );
    // an informational category can be
    await setNotificationMute(pool, owner, 'expenses', true);
    await setNotificationMute(pool, owner, 'expenses', false);
  });
});
