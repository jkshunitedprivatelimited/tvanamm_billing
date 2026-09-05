/**
 * Billing V1 Stage 4A - offline billing backend: signed authorization,
 * reserved receipt blocks (with void-on-expiry), batch sync, rate limiting.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import { identityTokenSecret } from '@jksh/config';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import { issueActivationCode, registerTerminal, revokeTerminal } from './terminal';
import { createEmployee } from './employee';
import { pinLogin, loadOperatorContext } from './store-auth';
import { createCatalogItem } from './catalog';
import { createAndApplyPublication, getPublishedMenu } from './menu-publish';
import { openCashSession, startShift } from './shifts';
import { issueOfflineAuth, reserveReceiptBlock, syncOfflineBills } from './offline';
import { mintOfflineAuthBundle } from './offline-auth';

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
let terminalId: string;
let employeeId: string;
let pin: string;
let itemId: string;
let menuVersion: string;
let menuChecksum: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Off ${role}`, role === 'central_admin'],
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

function offlineBillCmd(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: `idem-off-${S}-${randomUUID().slice(0, 8)}`,
    menuVersion,
    paymentMethod: 'cash' as const,
    lines: [{ catalogItemId: itemId, quantity: 1, addons: [] }],
    terminalOccurredAt: new Date().toISOString(),
    offline: true,
    ...overrides,
  };
}

describe.skipIf(!RUN)('Billing V1 Stage 4A - offline billing backend', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Offline Test Brand', true)`,
      [brand, JKSH_ORG, `off-brand-${S}`],
    );
    adminPhone = `+9189${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9188${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `off-${S}`, `off-${S}`],
    );
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);

    outletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, JKSH_ORG, brand, franchiseId, `OffOut${S.slice(-4)}`, `offout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const admin = await adminActor(adminPhone);
    itemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Off Item ${S}`,
        gstRate: '5',
        price: '100.00',
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
      notes: `stage4a-${S}`,
    });
    const published = await getPublishedMenu(pool, admin, outletId);
    menuVersion = published!.version;
    menuChecksum = published!.checksum;

    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Offline test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Offline iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    terminalId = term.terminalId;
    pin = String(6000 + (Date.now() % 3000));
    const emp = await createEmployee(pool, owner, {
      outletId,
      fullName: 'Offline Ravi',
      mobile: `+9187${S.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });
    employeeId = emp.employeeId;

    const op = await operator();
    await openCashSession(pool, op, { openingCash: '1000.00' });
    await startShift(pool, op, {});
  }, 90_000);

  afterAll(async () => {
    try {
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
        `delete from billing.bill_discounts where bill_id in (select id from billing.bills where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(
        `delete from billing.bill_lines where bill_id in (select id from billing.bills where outlet_id = $1)`,
        [outletId],
      );
      await pool.query(`delete from billing.bills where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.receipt_number_voids where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.receipt_reservations where outlet_id = $1`, [outletId]);
      await pool.query(`delete from billing.receipt_sequences where outlet_id = $1`, [outletId]);
      await pool.query(
        `delete from identity.sync_attempts where terminal_id in
        (select id from identity.terminals where outlet_id = $1)`,
        [outletId],
      );
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

  it('issues an offline authorization bundle covering the outlet employee and current menu', async () => {
    const op = await operator();
    const auth = await issueOfflineAuth(pool, op);
    expect(auth.token).toContain('jksh_off_v1.');
    const spanMs = new Date(auth.expiresAt).getTime() - new Date(auth.issuedAt).getTime();
    expect(spanMs).toBe(24 * 3_600_000);
  });

  it('reserves a contiguous receipt-number block', async () => {
    const op = await operator();
    const block = await reserveReceiptBlock(pool, op, { count: 3 });
    expect(block.numbers).toHaveLength(3);
    for (const n of block.numbers) expect(n).toMatch(/^\d{8}-T\d{2}-\d{6}$/);
    const seqs = block.numbers.map((n) => Number(n.slice(-6)));
    expect(seqs[1]).toBe(seqs[0]! + 1);
    expect(seqs[2]).toBe(seqs[1]! + 1);
    const spanMs = new Date(block.expiresAt).getTime() - Date.now();
    expect(spanMs).toBeGreaterThan(23 * 3_600_000);
    expect(spanMs).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('continues the same sequence after the terminal is replaced', async () => {
    const op = await operator();
    const before = await reserveReceiptBlock(pool, op, { count: 1 });
    const beforeSeq = Number(before.numbers[0]!.slice(-6));

    // Replace the terminal (revoke + re-register with the same activation flow).
    await revokeTerminal(pool, await adminActor(ownerPhone), terminalId, 'test replacement');
    const owner = await adminActor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Replacement',
      expiresInMinutes: 60,
    });
    const replaced = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Replacement iPad',
      paperWidthMm: 80,
    });
    terminalCredential = replaced.terminalCredential;
    terminalId = replaced.terminalId;

    const opNew = await operator();
    const after = await reserveReceiptBlock(pool, opNew, { count: 1 });
    const afterSeq = Number(after.numbers[0]!.slice(-6));
    expect(afterSeq).toBe(beforeSeq + 1); // continues, does not restart at 1
  }, 30_000);

  it('syncs a batch with per-bill results and rejects an offline bill without a reserved number', async () => {
    const op = await operator();
    const auth = await issueOfflineAuth(pool, op);
    const block = await reserveReceiptBlock(pool, op, { count: 2 });

    const good1 = offlineBillCmd({
      terminalReceiptNumber: block.numbers[0],
      offlineAuthBundle: auth.token,
    });
    const badReceipt = offlineBillCmd({
      terminalReceiptNumber: '20200101-T99-999999', // never reserved
      offlineAuthBundle: auth.token,
    });

    const res = await syncOfflineBills(pool, op, { bills: [good1, badReceipt] });
    expect(res.results).toHaveLength(2);
    expect(res.results[0]!.ok).toBe(true);
    expect(res.results[0]!.receiptNumber).toBe(block.numbers[0]);
    expect(res.results[1]!.ok).toBe(false);
    expect(res.results[1]!.error).toMatch(/not reserved/i);
  }, 30_000);

  it('rejects an offline bill with an invalid, mismatched, or expired authorization', async () => {
    const op = await operator();
    const block = await reserveReceiptBlock(pool, op, { count: 1 });

    // Garbage token.
    const garbled = offlineBillCmd({
      terminalReceiptNumber: block.numbers[0],
      offlineAuthBundle: 'not-a-real-token',
    });
    const r1 = await syncOfflineBills(pool, op, { bills: [garbled] });
    expect(r1.results[0]!.ok).toBe(false);
    expect(r1.results[0]!.errorCode).toBe('offline_auth_invalid');

    // Valid signature, but a stale menu checksum (crafted directly, not via issueOfflineAuth).
    const { token: staleMenuToken } = mintOfflineAuthBundle(identityTokenSecret(), {
      organizationId: JKSH_ORG,
      outletId,
      terminalId,
      employeeIds: [employeeId],
      menuVersion,
      menuChecksum: 'not-the-real-checksum',
    });
    const block2 = await reserveReceiptBlock(pool, op, { count: 1 });
    const r2 = await syncOfflineBills(pool, op, {
      bills: [
        offlineBillCmd({
          terminalReceiptNumber: block2.numbers[0],
          offlineAuthBundle: staleMenuToken,
        }),
      ],
    });
    expect(r2.results[0]!.ok).toBe(false);
    expect(r2.results[0]!.errorCode).toBe('offline_auth_invalid');

    // Valid bundle, but the bill claims to have happened after the 24h window.
    const { token: expiredToken } = mintOfflineAuthBundle(
      identityTokenSecret(),
      {
        organizationId: JKSH_ORG,
        outletId,
        terminalId,
        employeeIds: [employeeId],
        menuVersion,
        menuChecksum,
      },
      new Date(Date.now() - 25 * 3_600_000),
    );
    const block3 = await reserveReceiptBlock(pool, op, { count: 1 });
    const r3 = await syncOfflineBills(pool, op, {
      bills: [
        offlineBillCmd({
          terminalReceiptNumber: block3.numbers[0],
          offlineAuthBundle: expiredToken,
        }),
      ],
    });
    expect(r3.results[0]!.ok).toBe(false);
    expect(r3.results[0]!.errorCode).toBe('offline_auth_invalid');
  }, 30_000);

  it('caps an offline discount at the bundle policy and allows a discount within it', async () => {
    const op = await operator();
    const auth = await issueOfflineAuth(pool, op);

    const over = await reserveReceiptBlock(pool, op, { count: 1 });
    const overRes = await syncOfflineBills(pool, op, {
      bills: [
        offlineBillCmd({
          terminalReceiptNumber: over.numbers[0],
          offlineAuthBundle: auth.token,
          lines: [
            {
              catalogItemId: itemId,
              quantity: 1,
              addons: [],
              lineDiscount: { kind: 'percent', value: '50', reason: 'too generous' },
            },
          ],
        }),
      ],
    });
    expect(overRes.results[0]!.ok).toBe(false);
    expect(overRes.results[0]!.errorCode).toBe('conflict');
    expect(overRes.results[0]!.error).toMatch(/offline limit/i);

    const within = await reserveReceiptBlock(pool, op, { count: 1 });
    const withinRes = await syncOfflineBills(pool, op, {
      bills: [
        offlineBillCmd({
          terminalReceiptNumber: within.numbers[0],
          offlineAuthBundle: auth.token,
          lines: [
            {
              catalogItemId: itemId,
              quantity: 1,
              addons: [],
              lineDiscount: { kind: 'percent', value: '10', reason: 'loyalty' },
            },
          ],
        }),
      ],
    });
    expect(withinRes.results[0]!.ok).toBe(true);
  }, 30_000);

  it('voids unused numbers from an expired reservation instead of reassigning them', async () => {
    const op = await operator();
    const block = await reserveReceiptBlock(pool, op, { count: 2 });
    await pool.query(
      `update billing.receipt_reservations
          set expires_at = now() - interval '1 minute'
        where outlet_id = $1 and start_seq = $2`,
      [outletId, Number(block.numbers[0]!.slice(-6))],
    );
    // Reserving again triggers the opportunistic void-expired pass.
    await reserveReceiptBlock(pool, op, { count: 1 });

    const voided = await pool.query<{ receipt_number: string }>(
      `select receipt_number from billing.receipt_number_voids where outlet_id = $1`,
      [outletId],
    );
    const voidedNumbers = voided.rows.map((r) => r.receipt_number);
    expect(voidedNumbers).toEqual(expect.arrayContaining(block.numbers));

    const reservation = await pool.query<{ status: string }>(
      `select status from billing.receipt_reservations
        where outlet_id = $1 and start_seq = $2`,
      [outletId, Number(block.numbers[0]!.slice(-6))],
    );
    expect(reservation.rows[0]!.status).toBe('voided');
  }, 30_000);

  it('rate-limits repeated sync-related requests from the same terminal', async () => {
    // A dedicated fresh terminal so this test's count isn't inflated by every
    // reservation/sync call the earlier tests already made in this window.
    const owner = await adminActor(ownerPhone);
    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Rate limit test',
      expiresInMinutes: 60,
    });
    const rl = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Rate-limit iPad',
      paperWidthMm: 80,
    });
    terminalCredential = rl.terminalCredential;
    terminalId = rl.terminalId;

    // Log in once and reuse the actor - a real device would not re-authenticate
    // on every request, and this keeps the test to one round trip per attempt
    // over a (possibly remote, pooled) connection.
    const op = await operator();
    let limited = 0;
    for (let i = 0; i < 25; i += 1) {
      try {
        await reserveReceiptBlock(pool, op, { count: 1 });
      } catch (err) {
        if (err instanceof Error && /Too many sync requests/i.test(err.message)) limited += 1;
      }
    }
    expect(limited).toBeGreaterThan(0);
  }, 60_000);
});
