/**
 * Scheduled offers - automatic best-priority offer applied at checkout,
 * non-stacking, composing before an employee discount (`scheduled-offers.md`),
 * against a real Postgres.
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
import { createOffer, offerLifecycle } from './offer';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerPhone: string;
let brand: string;
let franchiseId: string;
let outletId: string;
let terminalCredential: string;
let pin: string;
let itemId: string;
let otherItemId: string;
let menuVersion: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Offer ${role}`, role === 'central_admin'],
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

describe.skipIf(!RUN)('Scheduled offers', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Offer Test Brand', true)`,
      [brand, JKSH_ORG, `offer-brand-${S}`],
    );
    adminPhone = `+9170${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9171${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `offer-${S}`, `offer-${S}`],
    );
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);

    outletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, JKSH_ORG, brand, franchiseId, `OfferOut${S.slice(-4)}`, `offerout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const admin = await adminActor(adminPhone);
    itemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Offer Chai ${S}`,
        gstRate: '5',
        price: '100.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        addonGroupIds: [],
      })
    ).id;
    otherItemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Offer Coffee ${S}`,
        gstRate: '5',
        price: '50.00',
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
      notes: `offer-${S}`,
    });
    menuVersion = (await getPublishedMenu(pool, admin, outletId))!.version;

    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Offer test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Offer iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    pin = String(3971 + (Date.now() % 900));
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Offer Ravi',
      mobile: `+9172${S.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });

    // Two overlapping offers on the same item; the lower `priority` number
    // wins and does not stack with the other. A wide date window so "today"
    // always falls inside it.
    const strong = (
      await createOffer(pool, admin, {
        brandId: brand,
        name: `Strong 30% ${S}`,
        label: '30% OFF',
        discountKind: 'percent',
        discountValue: '30',
        priority: 10,
        startsOn: '2000-01-01',
        endsOn: '2100-01-01',
        targets: [{ targetType: 'item', targetId: itemId }],
        outletIds: [outletId],
      })
    ).id;
    const weak = (
      await createOffer(pool, admin, {
        brandId: brand,
        name: `Weak 10% ${S}`,
        label: '10% OFF',
        discountKind: 'percent',
        discountValue: '10',
        priority: 50,
        startsOn: '2000-01-01',
        endsOn: '2100-01-01',
        targets: [{ targetType: 'item', targetId: itemId }],
        outletIds: [outletId],
      })
    ).id;
    await offerLifecycle(pool, admin, strong, { action: 'publish' });
    await offerLifecycle(pool, admin, weak, { action: 'publish' });
  }, 60_000);

  afterAll(async () => {
    try {
      await pool.query(
        `delete from billing.offer_targets where offer_id in
           (select id from billing.offers where brand_id = $1)`,
        [brand],
      );
      await pool.query(
        `delete from billing.offer_outlets where offer_id in
           (select id from billing.offers where brand_id = $1)`,
        [brand],
      );
      await pool.query(`delete from billing.offers where brand_id = $1`, [brand]);
      await pool.query(
        `delete from billing.payments where bill_id in (select id from billing.bills where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(
        `delete from billing.bill_discounts where bill_id in (select id from billing.bills where outlet_id = $1)`,
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
        [adminPhone, ownerPhone],
      ]);
      await pool.query(`delete from billing.brands where id = $1`, [brand]);
    } catch {
      /* best effort */
    }
    await pool.end();
  });

  it('applies the best-priority offer automatically, does not stack, and composes before an employee discount', async () => {
    const op = await operator();
    await openCashSession(pool, op, { openingCash: '500.00' });
    await startShift(pool, op, {});

    // Item 100.00, best offer is 30% -> offer discount 30.00, line 70.00.
    // The Coffee (50.00) has no offer.
    const bill = await createBill(pool, op, {
      idempotencyKey: `idem-offer-${S}-1`,
      menuVersion,
      paymentMethod: 'upi',
      lines: [
        { clientLineId: 'a', catalogItemId: itemId, quantity: 1, addons: [] },
        { clientLineId: 'b', catalogItemId: otherItemId, quantity: 1, addons: [] },
      ],
      terminalOccurredAt: new Date().toISOString(),
    });
    const chai = bill.lines.find((l) => l.catalogItemId === itemId)!;
    const coffee = bill.lines.find((l) => l.catalogItemId === otherItemId)!;
    expect(chai.offerLabel).toBe('30% OFF'); // not the 10% one
    expect(chai.offerDiscount).toBe('30.00');
    expect(chai.finalTotal).toBe('70.00');
    expect(coffee.offerLabel).toBeNull();
    expect(coffee.offerDiscount).toBe('0.00');
    expect(bill.finalTotal).toBe('120.00');

    // A manual employee line discount then composes on the post-offer amount
    // (10% of 70.00 = 7.00), never on the pre-offer 100.00.
    const bill2 = await createBill(pool, op, {
      idempotencyKey: `idem-offer-${S}-2`,
      menuVersion,
      paymentMethod: 'upi',
      lines: [
        {
          clientLineId: 'a',
          catalogItemId: itemId,
          quantity: 1,
          addons: [],
          lineDiscount: { kind: 'percent', value: '10', reason: 'regular customer' },
        },
      ],
      terminalOccurredAt: new Date().toISOString(),
    });
    const chai2 = bill2.lines[0]!;
    expect(chai2.offerDiscount).toBe('30.00');
    // total discount 30 + 7 = 37 -> final 63.00
    expect(chai2.discount).toBe('37.00');
    expect(chai2.finalTotal).toBe('63.00');
  }, 30_000);

  it('a paused offer stops applying', async () => {
    const admin = await adminActor(adminPhone);
    const paused = (
      await createOffer(pool, admin, {
        brandId: brand,
        name: `Pausable ${S}`,
        label: 'FLASH',
        discountKind: 'fixed',
        discountValue: '5.00',
        priority: 1,
        startsOn: '2000-01-01',
        endsOn: '2100-01-01',
        targets: [{ targetType: 'item', targetId: otherItemId }],
        outletIds: [outletId],
      })
    ).id;
    await offerLifecycle(pool, admin, paused, { action: 'publish' });

    const op = await operator();
    let bill = await createBill(pool, op, {
      idempotencyKey: `idem-offer-${S}-p1`,
      menuVersion,
      paymentMethod: 'upi',
      lines: [{ clientLineId: 'a', catalogItemId: otherItemId, quantity: 1, addons: [] }],
      terminalOccurredAt: new Date().toISOString(),
    });
    expect(bill.lines[0]!.offerLabel).toBe('FLASH');

    await offerLifecycle(pool, admin, paused, { action: 'pause' });
    bill = await createBill(pool, op, {
      idempotencyKey: `idem-offer-${S}-p2`,
      menuVersion,
      paymentMethod: 'upi',
      lines: [{ clientLineId: 'a', catalogItemId: otherItemId, quantity: 1, addons: [] }],
      terminalOccurredAt: new Date().toISOString(),
    });
    expect(bill.lines[0]!.offerLabel).toBeNull();
    expect(bill.lines[0]!.finalTotal).toBe('50.00');
  }, 30_000);
});
