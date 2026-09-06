/**
 * Outlet operational expenses - Cash-drawer reconciliation, owner review,
 * reversal-only correction, high-value flag (`outlet-expenses.md`), against a
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
import { pinLogin, loadOperatorContext } from './store-auth';
import { openCashSession, closeCashSession, startShift } from './shifts';
import { createCatalogItem } from './catalog';
import { createAndApplyPublication, getPublishedMenu } from './menu-publish';
import { createBill } from './bills';
import {
  recordExpense,
  reviewExpense,
  setExpenseThreshold,
  listExpenses,
  getExpenseReport,
} from './expense';

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
let itemId: string;
let menuVersion: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Exp ${role}`, role === 'central_admin' || role === 'accountant'],
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

describe.skipIf(!RUN)('Outlet operational expenses', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Expense Test Brand', true)`,
      [brand, JKSH_ORG, `exp-brand-${S}`],
    );
    adminPhone = `+9185${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9186${S.slice(-8).padStart(8, '0')}`;
    accountantPhone = `+9189${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `exp-${S}`, `exp-${S}`],
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
      [outletId, JKSH_ORG, brand, franchiseId, `ExpOut${S.slice(-4)}`, `expout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const admin = await adminActor(adminPhone);
    itemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Exp Chai ${S}`,
        gstRate: '5',
        price: '20.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        addonGroupIds: [],
      })
    ).id;
    await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletId],
      overwritePrice: false,
      forcedFields: [],
      notes: `exp-${S}`,
    });
    menuVersion = (await getPublishedMenu(pool, admin, outletId))!.version;

    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Expense test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Expense iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    pin = String(8000 + (Date.now() % 1500));
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Expense Ravi',
      mobile: `+9190${S.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await pool.query(`delete from billing.outlet_expenses where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.outlet_expense_settings where outlet_id = $1`, [
        outletId,
      ]);
      await pool.query(`delete from billing.expense_config where organization_id = $1`, [JKSH_ORG]);
      await pool.query(
        `delete from billing.payments where bill_id in (select id from billing.bills where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(
        `delete from billing.bill_lines where bill_id in (select id from billing.bills where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(`delete from billing.bills where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.receipt_sequences where outlet_id = $1`, [outletId]);
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
      await pool.query(
        `delete from billing.outlet_menu_version_items where outlet_menu_version_id in
           (select id from billing.outlet_menu_versions where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(`delete from billing.outlet_menu_versions where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.menu_publication_targets where outlet_id = $1`, [
        outletId,
      ]);
      await pool.query(`delete from billing.outlets where id = $1`, [outletId]);
      await pool.query(`delete from billing.menu_publications where brand_id = $1`, [brand]);
      await pool.query(`delete from billing.catalog_items where brand_id = $1`, [brand]);
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

  it('a drawer-paid expense reduces expected closing Cash; other sources do not', async () => {
    const op = await operator();
    const session = await openCashSession(pool, op, { openingCash: '2000.00' });
    await startShift(pool, op, {});

    // One Cash sale of 20.00 -> drawer should be 2000 + 20 = 2020 before expenses.
    await createBill(pool, op, {
      idempotencyKey: `idem-exp-bill-${S}-1`,
      menuVersion,
      paymentMethod: 'cash',
      lines: [{ clientLineId: 'c1', catalogItemId: itemId, quantity: 1, addons: [] }],
      terminalOccurredAt: new Date().toISOString(),
    });

    await recordExpense(pool, op, {
      idempotencyKey: `idem-exp-${S}-drawer`,
      outletId,
      categoryName: 'Cleaning supplies',
      amount: '150.00',
      paymentSource: 'shared_cash_drawer',
      reason: 'mop and detergent',
    });
    // A UPI-paid expense must not touch the drawer.
    await recordExpense(pool, op, {
      idempotencyKey: `idem-exp-${S}-upi`,
      outletId,
      categoryName: 'Transport',
      amount: '80.00',
      paymentSource: 'outlet_upi',
      reason: 'auto fare for supplies pickup',
    });

    // Expected = 2000 opening + 20 cash sale - 150 drawer expense = 1870.
    const closed = await closeCashSession(pool, await operator(), session.id, {
      countedCash: '1870.00',
    });
    expect(closed.expectedCash).toBe('1870.00');
    expect(closed.variance).toBe('0.00');
  }, 30_000);

  it('is idempotent on the same key', async () => {
    const op = await operator();
    const a = await recordExpense(pool, op, {
      idempotencyKey: `idem-exp-${S}-idem`,
      outletId,
      categoryName: 'Petty',
      amount: '25.00',
      paymentSource: 'employee_paid',
      reason: 'tea for staff',
    });
    const b = await recordExpense(pool, op, {
      idempotencyKey: `idem-exp-${S}-idem`,
      outletId,
      categoryName: 'Petty',
      amount: '25.00',
      paymentSource: 'employee_paid',
      reason: 'tea for staff',
    });
    expect(b.id).toBe(a.id);
  });

  it('owner reverses an incorrect expense instead of deleting it; reversal stops the drawer effect', async () => {
    const op = await operator();
    await openCashSession(pool, op, { openingCash: '1000.00' });
    const owner = await adminActor(ownerPhone);
    const bad = await recordExpense(pool, op, {
      idempotencyKey: `idem-exp-${S}-bad`,
      outletId,
      categoryName: 'Repairs',
      amount: '900.00',
      paymentSource: 'shared_cash_drawer',
      reason: 'wrong amount entered',
    });

    // Central sets a 500 default high-value threshold; 900 is flagged.
    await setExpenseThreshold(pool, await adminActor(adminPhone), { threshold: '500.00' });
    let list = await listExpenses(pool, owner, { outletId });
    const badRow = list.find((e) => e.id === bad.id)!;
    expect(badRow.isHighValue).toBe(true);
    expect(badRow.affectsDrawer).toBe(true);
    expect(badRow.reviewedAt).toBeNull();

    await reviewExpense(pool, owner, bad.id, { action: 'reverse', reason: 'amount was wrong' });
    list = await listExpenses(pool, owner, { outletId });
    const reversed = list.find((e) => e.id === bad.id)!;
    expect(reversed.reversedAt).not.toBeNull();
    expect(reversed.affectsDrawer).toBe(false);
    expect(reversed.reversalReason).toMatch(/amount was wrong/);

    // A reversed expense cannot be reversed again.
    await expect(
      reviewExpense(pool, owner, bad.id, { action: 'reverse', reason: 'again' }),
    ).rejects.toThrow(/already reversed/i);
  }, 30_000);

  it('an Accountant may read expense reports but not reverse', async () => {
    const accountant = await adminActor(accountantPhone);
    const report = await getExpenseReport(pool, accountant, {
      outletId,
      from: '2000-01-01',
      to: '2100-01-01',
    });
    expect(Number(report.total)).toBeGreaterThan(0);
    expect(Number(report.drawerTotal)).toBeGreaterThanOrEqual(0);

    const some = (await listExpenses(pool, accountant, { outletId }))[0]!;
    await expect(reviewExpense(pool, accountant, some.id, { action: 'approve' })).rejects.toThrow(
      /Denied/,
    );
  });
});
