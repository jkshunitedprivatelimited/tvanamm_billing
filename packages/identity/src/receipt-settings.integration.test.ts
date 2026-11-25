/**
 * Outlet receipt settings (migration 0046): owner-chosen receipt content
 * applied to every receipt rendered for the outlet. Real Postgres.
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
import { getReceiptSnapshot } from './receipts';
import { getReceiptSettings, maskMobile, updateReceiptSettings } from './receipt-settings';

const RUN = !!process.env.DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let owner: ActorContext;
let otherOwner: ActorContext;
let op: ActorContext;
let outletId: string;
let itemId: string;
let menuVersion: string;

async function adminActor(phone: string): Promise<ActorContext> {
  const authUserId = randomUUID();
  const r = await resolveAdminAfterVerify(pool, { authUserId, phone });
  if (r.result.outcome !== 'single_workspace') throw new Error('expected single workspace');
  const a = await buildAdminActor(pool, { authUserId, membershipId: r.result.membershipId });
  if (!a) throw new Error('no actor');
  return a;
}

async function seed(phone: string, role: string, brand: string, franchiseId: string | null) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now()) returning id`,
    [phone, `RS ${role}`, role === 'central_admin'],
  );
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, brand_id, franchise_id)
     values ($1,$2,$3,$4,$5)`,
    [rows[0]?.id, role, ORG, franchiseId ? brand : null, franchiseId],
  );
}

async function sale(customer?: { name?: string; mobile?: string }) {
  const bill = await createBill(pool, op, {
    idempotencyKey: `rs-${S}-${randomUUID()}`,
    menuVersion,
    paymentMethod: 'upi',
    lines: [{ catalogItemId: itemId, quantity: 1, addons: [], note: 'less sugar' }],
    terminalOccurredAt: new Date().toISOString(),
    ...(customer ? { customer } : {}),
  });
  return getReceiptSnapshot(pool, op, bill.id);
}

describe.skipIf(!RUN)('Outlet receipt settings', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);
    const brand = randomUUID();
    const franchiseId = randomUUID();
    const otherFranchise = randomUUID();
    outletId = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'RS Brand', true)`,
      [brand, ORG, `rs-brand-${S}`],
    );
    for (const f of [franchiseId, otherFranchise])
      await pool.query(
        `insert into billing.franchises (id, organization_id, brand_id, name, slug)
         values ($1,$2,$3,$4,$5)`,
        [f, ORG, brand, `rs-${f}`, `rs-${f}`],
      );
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, ORG, brand, franchiseId, `RsOut${S.slice(-4)}`, `rsout-${S}`],
    );
    const tail = S.slice(-8).padStart(8, '0');
    await seed(`+9161${tail}`, 'central_admin', brand, null);
    await seed(`+9162${tail}`, 'franchise_owner', brand, franchiseId);
    await seed(`+9163${tail}`, 'franchise_owner', brand, otherFranchise);
    const admin = await adminActor(`+9161${tail}`);
    owner = await adminActor(`+9162${tail}`);
    otherOwner = await adminActor(`+9163${tail}`);
    itemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `RS Tea ${S}`,
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
      notes: `rs-${S}`,
    });
    menuVersion = (await getPublishedMenu(pool, admin, outletId))?.version ?? '';
    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'RS counter',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'RS',
      paperWidthMm: 80,
    });
    const pin = String(4100 + (Date.now() % 3000));
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Ravi Kumar',
      mobile: `+9185${tail}`,
      initialPin: pin,
    });
    const login = await pinLogin(pool, { terminalCredential: term.terminalCredential, pin });
    if (login.result.outcome !== 'resolved' || !login.operatorToken) throw new Error('login');
    const ctx = await loadOperatorContext(pool, login.operatorToken);
    if (!ctx) throw new Error('no operator');
    op = ctx;
    await openCashSession(pool, op, { openingCash: '500.00' });
    await startShift(pool, op, {});
  }, 90_000);

  afterAll(async () => {
    await pool.end();
  });

  it('keeps customer details off the receipt by default', async () => {
    expect((await getReceiptSettings(pool, owner, outletId)).customerMobile).toBe('hidden');
    const r = await sale({ name: 'Priya', mobile: '+919876543210' });
    expect(r).toMatchObject({ customerName: null, customerMobile: null, cashierName: null });
    expect(r.footerNote).toBe('Thank you, visit again!');
    expect(r.layout?.showAddress).toBe(true);
  });

  it('prints what the owner turns on, for every later and reprinted receipt', async () => {
    await updateReceiptSettings(pool, owner, outletId, {
      showCustomerName: true,
      customerMobile: 'masked',
      showCashierName: true,
      showAddress: false,
      headerNote: 'FSSAI 12345678901234',
      footerNote: '',
    });
    const r = await sale({ name: 'Priya', mobile: '+919876543210' });
    expect(r).toMatchObject({
      customerName: 'Priya',
      customerMobile: '******3210',
      cashierName: 'Ravi Kumar',
      headerNote: 'FSSAI 12345678901234',
      footerNote: null,
    });
    expect(r.layout?.showAddress).toBe(false);
    expect(r.gstin === null || typeof r.gstin === 'string').toBe(true);

    await updateReceiptSettings(pool, owner, outletId, {
      showCustomerName: true,
      customerMobile: 'full',
    });
    expect((await sale({ mobile: '+919876543210' })).customerMobile).toBe('9876543210');
    // A bill without customer details prints no customer lines.
    expect(await sale()).toMatchObject({ customerName: null, customerMobile: null });
  });

  it('only the outlet’s owner (or Central) can change it', async () => {
    await expect(
      updateReceiptSettings(pool, otherOwner, outletId, { showCustomerName: true }),
    ).rejects.toThrow();
    await expect(getReceiptSettings(pool, op, outletId)).rejects.toThrow();
    await expect(
      updateReceiptSettings(pool, owner, outletId, { headerNote: 'x'.repeat(200) }),
    ).rejects.toThrow(/120/);
  });

  it('masks numbers to the last four digits', () => {
    expect(maskMobile('+91 98765-43210')).toBe('******3210');
    expect(maskMobile('12')).toBe('****');
  });
});
