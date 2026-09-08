/**
 * Billing V1 Stage 3 - cart -> checkout -> Cash/UPI -> receipt numbering,
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
import { createCatalogItem, pauseOutletItem } from './catalog';
import { createAndApplyPublication, getPublishedMenu } from './menu-publish';
import { openCashSession, closeCashSession, startShift } from './shifts';
import { createBill, getBill } from './bills';

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
let itemCoffeeId: string;
let menuVersion: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Bill ${role}`, role === 'central_admin'],
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

describe.skipIf(!RUN)('Billing V1 Stage 3 - bills', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Bill Test Brand', true)`,
      [brand, JKSH_ORG, `bill-brand-${S}`],
    );
    adminPhone = `+9191${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9190${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `bill-${S}`, `bill-${S}`],
    );
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);

    outletId = randomUUID();
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, JKSH_ORG, brand, franchiseId, `BillOut${S.slice(-4)}`, `billout-${S}`],
    );

    const owner = await adminActor(ownerPhone);
    const admin = await adminActor(adminPhone);
    itemChaiId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Chai ${S}`,
        gstRate: '5',
        price: '15.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        addonGroupIds: [],
      })
    ).id;
    itemCoffeeId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `Coffee ${S}`,
        gstRate: '5',
        price: '25.50',
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
      notes: `stage3-${S}`,
    });
    menuVersion = (await getPublishedMenu(pool, admin, outletId))!.version;

    const code = await issueActivationCode(pool, owner, {
      outletId,
      label: 'Bill test',
      expiresInMinutes: 60,
    });
    const term = await registerTerminal(pool, {
      code: code.code,
      deviceLabel: 'Bill iPad',
      paperWidthMm: 80,
    });
    terminalCredential = term.terminalCredential;
    pin = String(5000 + (Date.now() % 4000));
    await createEmployee(pool, owner, {
      outletId,
      fullName: 'Bill Ravi',
      mobile: `+9186${S.slice(-8).padStart(8, '0')}`,
      initialPin: pin,
    });

    const op = await operator();
    await openCashSession(pool, op, { openingCash: '2000.00' });
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

  it('creates a Cash bill: server-priced, receipt-numbered, with a payment row', async () => {
    const op = await operator();
    await startShift(pool, op, {});
    const bill = await createBill(pool, op, {
      idempotencyKey: `idem-cash-${S}-0001`,
      menuVersion,
      paymentMethod: 'cash',
      lines: [
        { catalogItemId: itemChaiId, quantity: 2, addons: [] },
        { catalogItemId: itemCoffeeId, quantity: 1, addons: [] },
      ],
      terminalOccurredAt: new Date().toISOString(),
    });
    expect(bill.receiptNumber).toMatch(/^\d{8}-T\d{2}-\d{6}$/);
    // businessDate is read back from a `date` column; on a server running
    // ahead of UTC (e.g. IST) a naive Date->toISOString() reformat shifts it
    // a day early. It must match the date already embedded in the receipt
    // number, which was formatted directly from the same IANA-timezone string.
    expect(bill.businessDate.replace(/-/g, '')).toBe(bill.receiptNumber.slice(0, 8));
    expect(bill.subtotal).toBe('55.50'); // 15*2 + 25.50
    expect(bill.preRoundTotal).toBe('55.50');
    expect(bill.finalTotal).toBe('56.00'); // Cash round up
    expect(bill.roundAdjustment).toBe('0.50');
    expect(bill.paymentMethod).toBe('cash');
    expect(bill.lines.find((l) => l.itemName === `Chai ${S}`)?.unitPrice).toBe('15.00');

    const pay = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.payments where bill_id = $1`,
      [bill.id],
    );
    expect(Number(pay.rows[0]!.n)).toBe(1);
    const ob = await pool.query<{ n: string; payload: { lines: { billLineId?: string }[] } }>(
      `select count(*)::int as n, (array_agg(payload))[1] as payload from outbox.events
        where event_type = 'SaleCompleted' and aggregate_id = $1`,
      [bill.id],
    );
    expect(Number(ob.rows[0]!.n)).toBe(1);
    // Stock's SaleCompleted consumer requires a billLineId on every line.
    const eventLines = ob.rows[0]!.payload.lines;
    expect(eventLines.length).toBeGreaterThan(0);
    for (const l of eventLines) {
      expect(l.billLineId).toMatch(/^[0-9a-f-]{36}$/);
    }
    const dbLineIds = new Set(
      (
        await pool.query<{ id: string }>(`select id from billing.bill_lines where bill_id = $1`, [
          bill.id,
        ])
      ).rows.map((r) => r.id),
    );
    for (const l of eventLines) expect(dbLineIds.has(l.billLineId!)).toBe(true);
  }, 30_000);

  it('is idempotent: the same key returns the original bill, once', async () => {
    const op = await operator();
    await startShift(pool, op, {});
    const key = `idem-dup-${S}-0002`;
    const first = await createBill(pool, op, {
      idempotencyKey: key,
      menuVersion,
      paymentMethod: 'upi',
      lines: [{ catalogItemId: itemChaiId, quantity: 1, addons: [] }],
      terminalOccurredAt: new Date().toISOString(),
    });
    const again = await createBill(pool, op, {
      idempotencyKey: key,
      menuVersion,
      paymentMethod: 'upi',
      lines: [{ catalogItemId: itemChaiId, quantity: 1, addons: [] }],
      terminalOccurredAt: new Date().toISOString(),
    });
    expect(again.id).toBe(first.id);
    const n = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.bills where outlet_id = $1 and idempotency_key = $2`,
      [outletId, key],
    );
    expect(Number(n.rows[0]!.n)).toBe(1);

    // The same key with a different cart is a client bug, not a retry.
    await expect(
      createBill(pool, op, {
        idempotencyKey: key,
        menuVersion,
        paymentMethod: 'upi',
        lines: [{ catalogItemId: itemChaiId, quantity: 5, addons: [] }],
        terminalOccurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/different sale/i);
  }, 30_000);

  it('rejects a stale menu version', async () => {
    const op = await operator();
    await startShift(pool, op, {});
    await expect(
      createBill(pool, op, {
        idempotencyKey: `idem-stale-${S}-0003`,
        menuVersion: '999999',
        paymentMethod: 'cash',
        lines: [{ catalogItemId: itemChaiId, quantity: 1, addons: [] }],
        terminalOccurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/menu changed|reload/i);
  }, 30_000);

  it('creates a complimentary bill (100% discount) with no payment row', async () => {
    const op = await operator();
    await startShift(pool, op, {});
    const bill = await createBill(pool, op, {
      idempotencyKey: `idem-comp-${S}-0004`,
      menuVersion,
      paymentMethod: null,
      lines: [
        {
          catalogItemId: itemChaiId,
          quantity: 1,
          addons: [],
          lineDiscount: { kind: 'percent', value: '100', reason: 'owner tasting' },
        },
      ],
      terminalOccurredAt: new Date().toISOString(),
    });
    expect(bill.isComplimentary).toBe(true);
    expect(bill.finalTotal).toBe('0.00');
    expect(bill.paymentMethod).toBeNull();
    const pay = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.payments where bill_id = $1`,
      [bill.id],
    );
    expect(Number(pay.rows[0]!.n)).toBe(0);
  }, 30_000);

  it('a Central Admin cannot create a bill', async () => {
    const admin = await adminActor(adminPhone);
    await expect(
      createBill(pool, admin, {
        idempotencyKey: `idem-central-${S}-0005`,
        menuVersion,
        paymentMethod: 'cash',
        lines: [{ catalogItemId: itemChaiId, quantity: 1, addons: [] }],
        terminalOccurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/operator session|Denied|forbidden/i);
  });

  it('blocks billing when there is no open cash session', async () => {
    const op = await operator();
    await startShift(pool, op, {});
    const { rows } = await pool.query<{ id: string }>(
      `select id from billing.cash_sessions where outlet_id = $1 and status = 'open'`,
      [outletId],
    );
    // The earlier Cash bill (56.00) rolls into expected cash: 2000 opening + 56 = 2056.
    const closed = await closeCashSession(pool, op, rows[0]!.id, { countedCash: '2056.00' });
    expect(closed.expectedCash).toBe('2056.00');
    expect(closed.variance).toBe('0.00');
    await expect(
      createBill(pool, op, {
        idempotencyKey: `idem-nocash-${S}-0006`,
        menuVersion,
        paymentMethod: 'cash',
        lines: [{ catalogItemId: itemChaiId, quantity: 1, addons: [] }],
        terminalOccurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/cash session/i);
    // restore for any later run
    await openCashSession(pool, await operator(), { openingCash: '2000.00' });
  }, 30_000);

  it('reads a bill back with its lines', async () => {
    const op = await operator();
    await startShift(pool, op, {});
    const bill = await createBill(pool, op, {
      idempotencyKey: `idem-read-${S}-0007`,
      menuVersion,
      paymentMethod: 'upi',
      lines: [{ catalogItemId: itemCoffeeId, quantity: 3, addons: [] }],
      terminalOccurredAt: new Date().toISOString(),
    });
    const fetched = await getBill(pool, op, bill.id);
    expect(fetched.lines).toHaveLength(1);
    expect(fetched.lines[0]!.quantity).toBe(3);
    expect(fetched.finalTotal).toBe('76.50');
  }, 30_000);

  it('a paused item blocks an online sale immediately, without a republish', async () => {
    const op = await operator();
    await startShift(pool, op, {});

    // A Store Employee may pause at their own outlet ...
    await pauseOutletItem(pool, op, {
      outletId,
      catalogItemId: itemChaiId,
      isAvailable: false,
      availabilityNote: 'Out of milk',
    });
    await expect(
      createBill(pool, op, {
        idempotencyKey: `idem-paused-${S}-0008`,
        menuVersion,
        paymentMethod: 'cash',
        lines: [{ catalogItemId: itemChaiId, quantity: 1, addons: [] }],
        terminalOccurredAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/out of stock/i);

    // ... but never for a different outlet, even with a well-formed command.
    const otherOutlet = randomUUID();
    await expect(
      pauseOutletItem(pool, op, {
        outletId: otherOutlet,
        catalogItemId: itemChaiId,
        isAvailable: false,
      }),
    ).rejects.toThrow(/own outlet/i);

    // The published snapshot itself never changes - only the live override.
    const snapshot = await getPublishedMenu(pool, await adminActor(adminPhone), outletId);
    expect(snapshot?.version).toBe(menuVersion);
    expect(snapshot?.items.find((i) => i.catalogItemId === itemChaiId)?.isAvailable).toBe(false);

    // Unpausing restores the sale immediately.
    await pauseOutletItem(pool, op, {
      outletId,
      catalogItemId: itemChaiId,
      isAvailable: true,
      availabilityNote: null,
    });
    const restored = await createBill(pool, op, {
      idempotencyKey: `idem-unpaused-${S}-0009`,
      menuVersion,
      paymentMethod: 'cash',
      lines: [{ catalogItemId: itemChaiId, quantity: 1, addons: [] }],
      terminalOccurredAt: new Date().toISOString(),
    });
    expect(restored.finalTotal).not.toBe('0.00');
  }, 30_000);
});
