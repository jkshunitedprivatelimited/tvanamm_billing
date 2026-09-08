/**
 * Billing V1 Stage 5 - bill history, reprinting, full/partial refunds.
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
import { createBill, getBill } from './bills';
import { createRefund } from './refunds';
import { recordPrintAttempt, getReceiptSnapshot } from './receipts';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerPhone: string;
let otherOwnerPhone: string;
let brand: string;
let franchiseId: string;
let otherFranchiseId: string;
let outletId: string;
let terminalId: string;
let terminalCredential: string;
let pinA: string;
let pinB: string;
let itemId: string;
let menuVersion: string;
let cashSessionId: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Rf ${role}`, role === 'central_admin'],
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

async function loginAs(pin: string): Promise<ActorContext> {
  const res = await pinLogin(pool, { terminalCredential, pin });
  if (res.result.outcome !== 'resolved' || !res.operatorToken) throw new Error('pin login failed');
  const a = await loadOperatorContext(pool, res.operatorToken);
  if (!a) throw new Error('no operator');
  return a;
}

async function ringUpBill(
  op: ActorContext,
  quantity = 1,
): Promise<Awaited<ReturnType<typeof createBill>>> {
  return createBill(pool, op, {
    idempotencyKey: `idem-rf-${S}-${randomUUID().slice(0, 8)}`,
    menuVersion,
    paymentMethod: 'cash',
    lines: [{ catalogItemId: itemId, quantity, addons: [] }],
    terminalOccurredAt: new Date().toISOString(),
  });
}

/** Inserts a bill row directly (bypassing createBill) so its committed_at /
 *  business_date can be back-dated - billing.bills is append-only, so this is
 *  the only way to simulate an old bill for the refund-window tests. */
async function insertOldBill(daysAgo: number): Promise<string> {
  const billId = randomUUID();
  const lineId = randomUUID();
  const pastAt = new Date(Date.now() - daysAgo * 86_400_000);
  const businessDateStr = pastAt.toISOString().slice(0, 10);
  await pool.query(
    `insert into billing.bills
       (id, organization_id, franchise_id, outlet_id, terminal_id, employee_id, employee_name,
        receipt_number, business_date, menu_version, subtotal, discount_total, pre_round_total,
        round_adjustment, final_total, payment_method, is_complimentary, is_offline,
        idempotency_key, terminal_occurred_at, committed_at, correlation_id)
     select $1, $2, o.franchise_id, $3, $4, se.id, se.full_name,
            $5, $6::date, $7, '50.00','0.00','50.00','0.00','50.00','cash',false,false,
            $8, $9::timestamptz, $9::timestamptz, $10
       from billing.outlets o, identity.store_employees se
      where o.id = $3 and se.outlet_id = $3 limit 1`,
    [
      billId,
      JKSH_ORG,
      outletId,
      terminalId,
      `${businessDateStr.replace(/-/g, '')}-T01-999${String(daysAgo).padStart(3, '0')}`,
      businessDateStr,
      menuVersion,
      `idem-old-${S}-${String(daysAgo)}`,
      pastAt.toISOString(),
      randomUUID(),
    ],
  );
  await pool.query(
    `insert into billing.bill_lines
       (id, bill_id, line_no, catalog_item_id, item_name, quantity, unit_price, gst_rate,
        base_total, discount, final_total)
     values ($1,$2,1,$3,'Old Line',1,'50.00','5','50.00','0.00','50.00')`,
    [lineId, billId, itemId],
  );
  await pool.query(
    `insert into billing.payments (bill_id, method, amount) values ($1,'cash','50.00')`,
    [billId],
  );
  return billId;
}

describe.skipIf(!RUN)('Billing V1 Stage 5 - history, printing, refunds', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Refund Test Brand', true)`,
      [brand, JKSH_ORG, `rf-brand-${S}`],
    );
    adminPhone = `+9179${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9178${S.slice(-8).padStart(8, '0')}`;
    otherOwnerPhone = `+9177${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    otherFranchiseId = randomUUID();
    for (const [id, n] of [
      [franchiseId, `rf-${S}`],
      [otherFranchiseId, `rfo-${S}`],
    ] as const) {
      await pool.query(
        `insert into billing.franchises (id, organization_id, brand_id, name, slug)
         values ($1,$2,$3,$4,$5)`,
        [id, JKSH_ORG, brand, n, n],
      );
    }
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);
    await seedAccount(otherOwnerPhone, 'franchise_owner', otherFranchiseId);

    outletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled, address_line, city, state, postal_code, phone)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true,'1 Test Rd','Hyderabad','TG','500001','+914000000000')`,
      [outletId, JKSH_ORG, brand, franchiseId, `RfOut${S.slice(-4)}`, `rfout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const admin = await adminActor(adminPhone);
    itemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Rf Item ${S}`,
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
      notes: `stage5-${S}`,
    });
    const published = await getPublishedMenu(pool, admin, outletId);
    menuVersion = published!.version;

    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Refund test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Refund iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    terminalId = term.terminalId;

    pinA = String(7000 + (Date.now() % 2000));
    pinB = String(Number(pinA) === 8999 ? 8998 : Number(pinA) + 1);
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Refund Anita',
      mobile: `+9176${S.slice(-8).padStart(8, '0')}`,
      initialPin: pinA,
    });
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Refund Bala',
      mobile: `+9175${S.slice(-8).padStart(8, '0')}`,
      initialPin: pinB,
    });

    const opA = await loginAs(pinA);
    const opened = await openCashSession(pool, opA, { openingCash: '1000.00' });
    cashSessionId = opened.id;
    await startShift(pool, opA, {});
  }, 90_000);

  afterAll(async () => {
    try {
      await pool.query(
        `delete from billing.refund_lines where refund_id in (select id from billing.refunds where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(`delete from billing.refunds where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.print_attempts where outlet_id = $1`, [outletId]);
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
      await pool.query(`delete from billing.outlet_menu_versions where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.menu_publication_targets where outlet_id = $1`, [
        outletId,
      ]);
      await pool.query(`delete from billing.menu_publications where brand_id = $1`, [brand]);
      await pool.query(`delete from billing.outlets where id = $1`, [outletId]);
      await pool.query(`delete from billing.catalog_items where brand_id = $1`, [brand]);
      await pool.query(`delete from identity.memberships where franchise_id = any($1::uuid[])`, [
        [franchiseId, otherFranchiseId],
      ]);
      await pool.query(`delete from billing.franchises where id = any($1::uuid[])`, [
        [franchiseId, otherFranchiseId],
      ]);
      await pool.query(`delete from identity.account_profiles where mobile = any($1::text[])`, [
        [adminPhone, ownerPhone, otherOwnerPhone],
      ]);
      await pool.query(`delete from billing.brands where id = $1`, [brand]);
    } catch {
      /* best effort */
    }
    await pool.end();
  });

  it('fully refunds a bill and reflects it on the bill status', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 1);
    expect(bill.finalTotal).toBe('50.00');

    const refund = await createRefund(pool, opA, {
      idempotencyKey: `idem-full-${S}`,
      billId: bill.id,
      kind: 'full',
      payoutMethod: 'cash',
      reason: 'customer changed mind',
    });
    expect(refund.amount).toBe('50.00');
    expect(refund.lines).toHaveLength(1);

    const after = await getBill(pool, opA, bill.id);
    expect(after.status).toBe('fully_refunded');
    expect(after.remainingRefundable).toBe('0.00');
    expect(after.lines[0]!.refundedQuantity).toBe(1);
  }, 30_000);

  it('partially refunds by quantity and prevents refunding more than remains', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 3);
    expect(bill.finalTotal).toBe('150.00');

    // Refund 1 of 3.
    const first = await createRefund(pool, opA, {
      idempotencyKey: `idem-partial1-${S}`,
      billId: bill.id,
      kind: 'partial',
      payoutMethod: 'cash',
      reason: 'one item wrong',
      lines: [{ billLineId: await lineIdOf(bill.id), quantity: 1 }],
    });
    expect(first.amount).toBe('50.00');

    const mid = await getBill(pool, opA, bill.id);
    expect(mid.status).toBe('partially_refunded');
    expect(mid.remainingRefundable).toBe('100.00');

    // Refund 2 more (now fully refunded).
    await createRefund(pool, opA, {
      idempotencyKey: `idem-partial2-${S}`,
      billId: bill.id,
      kind: 'partial',
      payoutMethod: 'cash',
      reason: 'rest also wrong',
      lines: [{ billLineId: await lineIdOf(bill.id), quantity: 2 }],
    });
    const done = await getBill(pool, opA, bill.id);
    expect(done.status).toBe('fully_refunded');

    // A further refund attempt must fail: nothing remains.
    await expect(
      createRefund(pool, opA, {
        idempotencyKey: `idem-partial3-${S}`,
        billId: bill.id,
        kind: 'partial',
        payoutMethod: 'cash',
        reason: 'greedy',
        lines: [{ billLineId: await lineIdOf(bill.id), quantity: 1 }],
      }),
    ).rejects.toThrow(/exceeds what remains/i);
  }, 30_000);

  it('prevents a concurrent refund from exceeding the original quantity', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 2);
    const billLineId = await lineIdOf(bill.id);

    const attempt = (key: string): ReturnType<typeof createRefund> =>
      createRefund(pool, opA, {
        idempotencyKey: key,
        billId: bill.id,
        kind: 'partial',
        payoutMethod: 'cash',
        reason: 'race',
        lines: [{ billLineId, quantity: 2 }],
      });

    const results = await Promise.allSettled([
      attempt(`idem-race-a-${S}`),
      attempt(`idem-race-b-${S}`),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    // Only one of the two 2-unit refunds against a 2-unit line can succeed.
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const after = await getBill(pool, opA, bill.id);
    expect(after.status).toBe('fully_refunded');
  }, 30_000);

  it('rejects a UPI refund without a payout reference, accepts one with it', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 1);
    await expect(
      createRefund(pool, opA, {
        idempotencyKey: `idem-upi-noref-${S}`,
        billId: bill.id,
        kind: 'full',
        payoutMethod: 'upi',
        reason: 'switch payout',
      }),
    ).rejects.toThrow(/payout reference/i);

    const ok = await createRefund(pool, opA, {
      idempotencyKey: `idem-upi-ref-${S}`,
      billId: bill.id,
      kind: 'full',
      payoutMethod: 'upi',
      reason: 'switch payout',
      payoutReference: 'UPI-REF-123',
    });
    expect(ok.payoutMethod).toBe('upi');
    expect(ok.payoutReference).toBe('UPI-REF-123');
  }, 30_000);

  it('a Cash refund reduces the cash session expected total (drawer impact)', async () => {
    const opA = await loginAs(pinA);
    const expectedBefore = await pool.query<{ expected: string }>(
      `select cs.opening_cash
              + coalesce((select sum(p.amount) from billing.payments p
                            join billing.bills b on b.id = p.bill_id
                           where b.cash_session_id = cs.id and p.method = 'cash'), 0)
              - coalesce((select sum(r.amount) from billing.refunds r
                           where r.cash_session_id = cs.id and r.payout_method = 'cash'), 0)
                as expected
         from billing.cash_sessions cs where cs.id = $1`,
      [cashSessionId],
    );

    const bill = await ringUpBill(opA, 1); // +50.00 cash
    await createRefund(pool, opA, {
      idempotencyKey: `idem-drawer-${S}`,
      billId: bill.id,
      kind: 'full',
      payoutMethod: 'cash',
      reason: 'drawer test',
    }); // -50.00 cash: nets back to where it started

    const expectedAfter = await pool.query<{ expected: string }>(
      `select cs.opening_cash
              + coalesce((select sum(p.amount) from billing.payments p
                            join billing.bills b on b.id = p.bill_id
                           where b.cash_session_id = cs.id and p.method = 'cash'), 0)
              - coalesce((select sum(r.amount) from billing.refunds r
                           where r.cash_session_id = cs.id and r.payout_method = 'cash'), 0)
                as expected
         from billing.cash_sessions cs where cs.id = $1`,
      [cashSessionId],
    );
    expect(Number(expectedAfter.rows[0]!.expected)).toBeCloseTo(
      Number(expectedBefore.rows[0]!.expected),
      2,
    );
  }, 30_000);

  it('a Franchise Owner can refund; a Central Admin and another franchise cannot', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 1);
    const owner = await adminActor(ownerPhone);
    const refund = await createRefund(pool, owner, {
      idempotencyKey: `idem-owner-${S}`,
      billId: bill.id,
      kind: 'full',
      payoutMethod: 'cash',
      reason: 'owner-initiated',
    });
    expect(refund.actorName).not.toBe('');

    const bill2 = await ringUpBill(opA, 1);
    const admin = await adminActor(adminPhone);
    await expect(
      createRefund(pool, admin, {
        idempotencyKey: `idem-central-${S}`,
        billId: bill2.id,
        kind: 'full',
        payoutMethod: 'cash',
        reason: 'central attempt',
      }),
    ).rejects.toThrow(/Denied|row-level security/);

    const otherOwner = await adminActor(otherOwnerPhone);
    await expect(
      createRefund(pool, otherOwner, {
        idempotencyKey: `idem-other-${S}`,
        billId: bill2.id,
        kind: 'full',
        payoutMethod: 'cash',
        reason: 'wrong franchise',
      }),
    ).rejects.toThrow(/Denied|row-level security|not found/);
  }, 30_000);

  it('rejects a same-day-only Store Employee refund of a prior business date, allows the owner within 60 days, and blocks past 60', async () => {
    const yesterdayBill = await insertOldBill(1);
    const opA = await loginAs(pinA);
    await expect(
      createRefund(pool, opA, {
        idempotencyKey: `idem-emp-old-${S}`,
        billId: yesterdayBill,
        kind: 'full',
        payoutMethod: 'cash',
        reason: 'too old for employee',
      }),
    ).rejects.toThrow(/today/i);

    const owner = await adminActor(ownerPhone);
    const withinWindow = await createRefund(pool, owner, {
      idempotencyKey: `idem-owner-old-${S}`,
      billId: yesterdayBill,
      kind: 'full',
      payoutMethod: 'cash',
      reason: 'owner can refund yesterday',
    });
    expect(withinWindow.amount).toBe('50.00');

    const veryOldBill = await insertOldBill(61);
    await expect(
      createRefund(pool, owner, {
        idempotencyKey: `idem-owner-verold-${S}`,
        billId: veryOldBill,
        kind: 'full',
        payoutMethod: 'cash',
        reason: 'too old even for owner',
      }),
    ).rejects.toThrow(/60-day/i);
  }, 30_000);

  it('emits a SaleRefunded outbox event with quantities and wastage classification', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 1);
    await createRefund(pool, opA, {
      idempotencyKey: `idem-outbox-${S}`,
      billId: bill.id,
      kind: 'full',
      payoutMethod: 'cash',
      reason: 'outbox check',
    });
    const events = await pool.query<{ payload: { lines: { wastageClassification: string }[] } }>(
      `select payload from outbox.events where event_type = 'SaleRefunded'
        and payload->>'billId' = $1`,
      [bill.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.payload.lines[0]!.wastageClassification).toBe('customer_cancelled');
  }, 30_000);

  it('any employee can reprint a same-day bill, and the receipt hides internal fields', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 1);

    const opB = await loginAs(pinB);
    const attempt = await recordPrintAttempt(pool, opB, bill.id, { result: 'success' });
    expect(attempt.id).toBeTruthy();

    const snapshot = await getReceiptSnapshot(pool, opB, bill.id);
    expect(snapshot.receiptNumber).toBe(bill.receiptNumber);
    expect(snapshot.outletName).toContain('RfOut');
    expect(JSON.stringify(snapshot)).not.toContain('Refund Anita');
    expect(JSON.stringify(snapshot)).not.toContain('Refund Bala');
    const printLog = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.print_attempts where bill_id = $1`,
      [bill.id],
    );
    expect(Number(printLog.rows[0]!.n)).toBe(1);
  }, 30_000);

  it('rejects a cash refund when no cash session is open, then works once reopened', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 1);

    await pool.query(
      `update billing.cash_sessions
          set status = 'closed', closed_at = now(),
              closed_by_employee_id = opened_by_employee_id,
              closed_by_name = opened_by_name,
              counted_cash = opening_cash
        where outlet_id = $1 and status = 'open'`,
      [outletId],
    );

    await expect(
      createRefund(pool, opA, {
        idempotencyKey: `idem-nocash-${S}`,
        billId: bill.id,
        kind: 'full',
        payoutMethod: 'cash',
        reason: 'no session',
      }),
    ).rejects.toThrow(/cash session/i);

    // A UPI refund is unaffected by the missing cash session.
    const upi = await createRefund(pool, opA, {
      idempotencyKey: `idem-nocash-upi-${S}`,
      billId: bill.id,
      kind: 'full',
      payoutMethod: 'upi',
      payoutReference: 'UTR-NO-CASH',
      reason: 'no session upi',
    });
    expect(upi.payoutMethod).toBe('upi');

    const reopened = await openCashSession(pool, opA, { openingCash: '1000.00' });
    cashSessionId = reopened.id;
  }, 30_000);

  it('freezes the outlet legal details onto the receipt at bill time', async () => {
    const opA = await loginAs(pinA);
    const bill = await ringUpBill(opA, 1);
    const original = await getReceiptSnapshot(pool, opA, bill.id);
    expect(original.outletName).toContain('RfOut');

    // The outlet is later renamed and re-registered under a new GSTIN.
    await pool.query(
      `update billing.outlets set display_name = 'Renamed Outlet XYZ', gstin = '99ZZZZZ9999Z9Z9'
        where id = $1`,
      [outletId],
    );

    const reprint = await getReceiptSnapshot(pool, opA, bill.id);
    expect(reprint.outletName).toBe(original.outletName);
    expect(reprint.gstin).toBe(original.gstin);
    expect(reprint.outletName).not.toContain('Renamed');
  }, 30_000);
});

async function lineIdOf(billId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from billing.bill_lines where bill_id = $1 order by line_no limit 1`,
    [billId],
  );
  return rows[0]!.id;
}
