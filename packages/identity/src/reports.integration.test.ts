/**
 * Billing V1 Stage 6 - financial reports (dashboard-projection queries).
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
import { createCatalogItem } from './catalog';
import { createAndApplyPublication, getPublishedMenu } from './menu-publish';
import { openCashSession, startShift } from './shifts';
import { createBill } from './bills';
import { createRefund } from './refunds';
import { getFinancialReport } from './reports';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerAPhone: string;
let brand: string;
let franchiseA: string;
let franchiseB: string;
let outletA: string;
let outletB: string;
let itemId: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Rep ${role}`, role === 'central_admin'],
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

async function setupOutletWithBill(
  franchiseId: string,
  label: string,
  paymentMethod: 'cash' | 'upi',
): Promise<{ outletId: string; menuVersion: string; billId: string }> {
  const admin = await adminActor(adminPhone);
  const outletId = randomUUID();
  await pool.query(
    `insert into billing.outlets
       (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
        billing_enabled)
     values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
    [outletId, JKSH_ORG, brand, franchiseId, label, `${label.toLowerCase()}-${S}`],
  );
  await createAndApplyPublication(pool, admin, {
    brandId: brand,
    scope: 'master',
    targetOutletIds: [outletId],
    overwritePrice: false,
    forcedFields: [],
    notes: `stage6-${S}`,
  });
  const published = await getPublishedMenu(pool, admin, outletId);
  const menuVersion = published!.version;

  const code = await issueActivationCode(pool, admin, {
    outletId,
    label: 'Report test',
    expiresInMinutes: 60,
  });
  const term = await registerTerminal(pool, {
    code: code.code,
    deviceLabel: `${label} iPad`,
    paperWidthMm: 80,
  });
  const pin = String(3000 + Math.floor(Math.random() * 3000));
  await createEmployee(pool, admin, {
    outletId,
    fullName: `${label} Employee`,
    mobile: `+91${String(60 + outletId.charCodeAt(0)).slice(0, 2)}${S.slice(-8).padStart(8, '0')}`,
    initialPin: pin,
  });
  const res = await pinLogin(pool, { terminalCredential: term.terminalCredential, pin });
  if (res.result.outcome !== 'resolved' || !res.operatorToken) throw new Error('pin login failed');
  const op = await loadOperatorContext(pool, res.operatorToken);
  if (!op) throw new Error('no operator');
  await openCashSession(pool, op, { openingCash: '500.00' });
  await startShift(pool, op, {});

  const bill = await createBill(pool, op, {
    idempotencyKey: `idem-report-${S}-${label}`,
    menuVersion,
    paymentMethod,
    lines: [{ catalogItemId: itemId, quantity: 1, addons: [] }],
    terminalOccurredAt: new Date().toISOString(),
  });
  return { outletId, menuVersion, billId: bill.id };
}

describe.skipIf(!RUN)('Billing V1 Stage 6 - financial reports', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Report Test Brand', true)`,
      [brand, JKSH_ORG, `rep-brand-${S}`],
    );
    adminPhone = `+9169${S.slice(-8).padStart(8, '0')}`;
    ownerAPhone = `+9168${S.slice(-8).padStart(8, '0')}`;
    franchiseA = randomUUID();
    franchiseB = randomUUID();
    for (const [id, n] of [
      [franchiseA, `rep-a-${S}`],
      [franchiseB, `rep-b-${S}`],
    ] as const) {
      await pool.query(
        `insert into billing.franchises (id, organization_id, brand_id, name, slug)
         values ($1,$2,$3,$4,$5)`,
        [id, JKSH_ORG, brand, n, n],
      );
    }
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerAPhone, 'franchise_owner', franchiseA);

    const admin = await adminActor(adminPhone);
    itemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Rep Item ${S}`,
        gstRate: '5',
        price: '100.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        addonGroupIds: [],
      })
    ).id;

    const a = await setupOutletWithBill(franchiseA, `RepOutA${S.slice(-4)}`, 'cash');
    outletA = a.outletId;

    const b = await setupOutletWithBill(franchiseB, `RepOutB${S.slice(-4)}`, 'upi');
    outletB = b.outletId;

    // Refund the outletA bill today so its net effect shows up in today's report.
    const owner = await adminActor(ownerAPhone);
    await createRefund(pool, owner, {
      idempotencyKey: `idem-report-refund-${S}`,
      billId: a.billId,
      kind: 'full',
      payoutMethod: 'cash',
      reason: 'report test refund',
    });
  }, 90_000);

  afterAll(async () => {
    try {
      for (const outletId of [outletA, outletB]) {
        await pool.query(
          `delete from billing.refund_lines where refund_id in (select id from billing.refunds where outlet_id = $1)`,
          [outletId],
        );
        await pool.query(`delete from billing.refunds where outlet_id = $1`, [outletId]);
        await pool.query(
          `delete from billing.payments where bill_id in (select id from billing.bills where outlet_id = $1)`,
          [outletId],
        );
        await pool.query(
          `delete from billing.bill_line_addons where bill_line_id in
             (select bl.id from billing.bill_lines bl join billing.bills b on b.id = bl.bill_id
               where b.outlet_id = $1)`,
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
        await pool.query(`delete from billing.outlet_menu_versions where outlet_id = $1`, [
          outletId,
        ]);
        await pool.query(`delete from billing.menu_publication_targets where outlet_id = $1`, [
          outletId,
        ]);
        await pool.query(`delete from billing.outlets where id = $1`, [outletId]);
      }
      await pool.query(`delete from billing.menu_publications where brand_id = $1`, [brand]);
      await pool.query(`delete from billing.catalog_items where brand_id = $1`, [brand]);
      await pool.query(`delete from identity.memberships where franchise_id = any($1::uuid[])`, [
        [franchiseA, franchiseB],
      ]);
      await pool.query(`delete from billing.franchises where id = any($1::uuid[])`, [
        [franchiseA, franchiseB],
      ]);
      await pool.query(`delete from identity.account_profiles where mobile = any($1::text[])`, [
        [adminPhone, ownerAPhone],
      ]);
      await pool.query(`delete from billing.brands where id = $1`, [brand]);
    } catch {
      /* best effort */
    }
    await pool.end();
  });

  it('a Franchise Owner sees only their own outlet, with the refund reducing net sales', async () => {
    const owner = await adminActor(ownerAPhone);
    const { combined, byOutlet } = await getFinancialReport(pool, owner, { kind: 'today' });
    expect(byOutlet).toHaveLength(1);
    expect(byOutlet[0]!.outletId).toBe(outletA);
    expect(byOutlet[0]!.grossSales).toBe('100.00');
    expect(byOutlet[0]!.refundTotal).toBe('100.00');
    expect(byOutlet[0]!.netSales).toBe('0.00');
    expect(combined.billCount).toBe(1);
  }, 30_000);

  it('a Central Admin sees combined totals across every franchise/outlet', async () => {
    const admin = await adminActor(adminPhone);
    const { combined, byOutlet } = await getFinancialReport(pool, admin, { kind: 'today' }, {});
    const ids = byOutlet.map((o) => o.outletId);
    expect(ids).toEqual(expect.arrayContaining([outletA, outletB]));
    expect(combined.billCount).toBeGreaterThanOrEqual(2);
    const outletBSummary = byOutlet.find((o) => o.outletId === outletB)!;
    expect(outletBSummary.upiTotal).toBe('100.00');
    expect(outletBSummary.cashTotal).toBe('0.00');
  }, 30_000);

  it('a Central Admin can filter the report to one franchise', async () => {
    const admin = await adminActor(adminPhone);
    const { byOutlet } = await getFinancialReport(
      pool,
      admin,
      { kind: 'today' },
      { franchiseId: franchiseB },
    );
    expect(byOutlet).toHaveLength(1);
    expect(byOutlet[0]!.outletId).toBe(outletB);
  });

  it('a Store Employee has no report capability', async () => {
    // Any operator actor is rejected before touching the database.
    const admin = await adminActor(adminPhone);
    const fakeOperator = { ...admin, kind: 'operator', role: 'store_employee' } as typeof admin;
    await expect(getFinancialReport(pool, fakeOperator, { kind: 'today' })).rejects.toThrow(
      /Denied/,
    );
  });
});
