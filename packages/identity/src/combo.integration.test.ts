/**
 * Combos - proportional value/tax allocation across exploded component sale
 * lines (`menu-publishing.md`), against a real Postgres.
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
import { createCombo, updateCombo } from './combo';
import { createAndApplyPublication, getPublishedMenu } from './menu-publish';
import { openCashSession, startShift } from './shifts';
import { createBill, getBill } from './bills';
import { createRefund } from './refunds';
import { getReceiptSnapshot } from './receipts';

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
let itemChaiId: string;
let itemSamosaId: string;
let comboId: string;
let menuVersion: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Combo ${role}`, role === 'central_admin'],
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

describe.skipIf(!RUN)('Combos - proportional allocation', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Combo Test Brand', true)`,
      [brand, JKSH_ORG, `combo-brand-${S}`],
    );
    adminPhone = `+9180${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9181${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `combo-${S}`, `combo-${S}`],
    );
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);

    outletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, JKSH_ORG, brand, franchiseId, `ComboOut${S.slice(-4)}`, `comboout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const admin = await adminActor(adminPhone);
    // Deliberately different prices/GST so the proportional split is a real
    // test, not a coincidental 50/50 split: Chai 15.00 (5% GST), Samosa 20.00
    // (12% GST). Combo bundles 1 chai + 1 samosa for 30.00 (a discount off
    // the 35.00 standalone total).
    itemChaiId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Combo Chai ${S}`,
        gstRate: '5',
        price: '15.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        addonGroupIds: [],
      })
    ).id;
    itemSamosaId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Combo Samosa ${S}`,
        gstRate: '12',
        price: '20.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        addonGroupIds: [],
      })
    ).id;
    comboId = (
      await createCombo(pool, admin, {
        brandId: brand,
        name: `Snack Combo ${S}`,
        price: '30.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        components: [
          { catalogItemId: itemChaiId, quantity: 1 },
          { catalogItemId: itemSamosaId, quantity: 1 },
        ],
      })
    ).id;

    await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletId],
      overwritePrice: false,
      forcedFields: [],
      notes: `combo-${S}`,
    });
    menuVersion = (await getPublishedMenu(pool, admin, outletId))!.version;

    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Combo test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Combo iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    pin = String(6000 + (Date.now() % 3000));
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Combo Ravi',
      mobile: `+9187${S.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });
  }, 60_000);

  afterAll(async () => {
    try {
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
        `delete from billing.outlet_menu_version_combos where outlet_menu_version_id in
           (select id from billing.outlet_menu_versions where outlet_id = $1)`,
        [outletId],
      );
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
      await pool.query(`delete from billing.combo_components where combo_id = $1`, [comboId]);
      await pool.query(`delete from billing.combos where id = $1`, [comboId]);
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

  it('explodes a combo line into proportionally-allocated component lines summing exactly to the combo total', async () => {
    const op = await operator();
    await openCashSession(pool, op, { openingCash: '500.00' });
    await startShift(pool, op, {});

    const bill = await createBill(pool, op, {
      idempotencyKey: `idem-combo-${S}-0001`,
      menuVersion,
      paymentMethod: 'cash',
      lines: [{ clientLineId: 'c1', comboId, quantity: 2 }],
      terminalOccurredAt: new Date().toISOString(),
    });

    expect(bill.lines).toHaveLength(2);
    const chaiLine = bill.lines.find((l) => l.catalogItemId === itemChaiId);
    const samosaLine = bill.lines.find((l) => l.catalogItemId === itemSamosaId);
    expect(chaiLine).toBeDefined();
    expect(samosaLine).toBeDefined();
    expect(chaiLine!.comboId).toBe(comboId);
    expect(chaiLine!.comboName).toBe(`Snack Combo ${S}`);
    expect(chaiLine!.comboGroupId).toBe(samosaLine!.comboGroupId);
    // 2 combo units -> 2 of each component.
    expect(chaiLine!.quantity).toBe(2);
    expect(samosaLine!.quantity).toBe(2);
    // Combo price 30.00 x 2 units = 60.00, split by standalone weight
    // (15 vs 20, i.e. 3:4) -> 25.71 : 34.29 (floor + remainder to last).
    const chaiTotal = Number(chaiLine!.finalTotal);
    const samosaTotal = Number(samosaLine!.finalTotal);
    expect((chaiTotal + samosaTotal).toFixed(2)).toBe('60.00');
    expect(chaiTotal).toBeLessThan(samosaTotal);
    expect(bill.finalTotal).toBe('60.00');

    // The customer receipt groups exploded lines under the combo's name.
    const receipt = await getReceiptSnapshot(pool, op, bill.id);
    expect(receipt.lines.every((l) => l.comboName === `Snack Combo ${S}`)).toBe(true);
  }, 30_000);

  it('refunds one exploded component line at its own allocated amount', async () => {
    const op = await operator();
    const bill = await createBill(pool, op, {
      idempotencyKey: `idem-combo-${S}-0002`,
      menuVersion,
      paymentMethod: 'upi',
      lines: [{ clientLineId: 'c1', comboId, quantity: 1 }],
      terminalOccurredAt: new Date().toISOString(),
    });
    const chaiLine = bill.lines.find((l) => l.catalogItemId === itemChaiId)!;

    const owner = await adminActor(ownerPhone);
    const refund = await createRefund(pool, owner, {
      idempotencyKey: `idem-combo-refund-${S}`,
      billId: bill.id,
      kind: 'partial',
      payoutMethod: 'upi',
      payoutReference: 'UPI-COMBO-REFUND',
      reason: 'customer did not want the chai',
      lines: [{ billLineId: chaiLine.id, quantity: 1 }],
    });
    expect(refund.amount).toBe(chaiLine.finalTotal);

    const after = await getBill(pool, owner, bill.id);
    expect(after.status).toBe('partially_refunded');
    expect(after.remainingRefundable).toBe(
      (Number(bill.finalTotal) - Number(chaiLine.finalTotal)).toFixed(2),
    );
  }, 30_000);

  it('a Store Employee operator session may never author a combo', async () => {
    // RLS hides a master combo from an operator entirely (same as any other
    // master catalog row), so this surfaces as "not found" rather than
    // "denied" - either way, nothing is written.
    await expect(
      updateCombo(pool, await operator(), comboId, { price: '1.00' } as never),
    ).rejects.toThrow(/Denied|not found/i);
    const row = await pool.query<{ price: string }>(
      `select price from billing.combos where id = $1`,
      [comboId],
    );
    expect(row.rows[0]?.price).toBe('30.00');
  });
});
