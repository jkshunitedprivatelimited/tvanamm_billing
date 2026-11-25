/**
 * Parallel billing (migration 0045): several active terminals per outlet, each
 * with its own receipt prefix and sequence, one shared cash drawer, and
 * explicit replacement that continues a terminal's prefix. Real Postgres.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import {
  issueActivationCode,
  listTerminals,
  MAX_TERMINALS_PER_OUTLET,
  registerTerminal,
  revokeTerminal,
} from './terminal';
import { createEmployee } from './employee';
import { pinLogin, loadOperatorContext } from './store-auth';
import { createCatalogItem } from './catalog';
import { createAndApplyPublication, getPublishedMenu } from './menu-publish';
import { openCashSession, startShift } from './shifts';
import { createBill } from './bills';

const RUN = !!process.env.DATABASE_URL;
const ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let owner: ActorContext;
let outletId: string;
let itemId: string;
let menuVersion: string;
const pins: string[] = [];

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
    [phone, `MT ${role}`, role === 'central_admin'],
  );
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, brand_id, franchise_id)
     values ($1,$2,$3,$4,$5)`,
    [rows[0]?.id, role, ORG, franchiseId ? brand : null, franchiseId],
  );
}

async function addTerminal(label: string, replacesTerminalId?: string) {
  const code = await issueActivationCode(pool, owner, {
    outletId,
    label,
    expiresInMinutes: 60,
    ...(replacesTerminalId ? { replacesTerminalId } : {}),
  });
  return registerTerminal(pool, { code: code.code, deviceLabel: label, paperWidthMm: 80 });
}

async function operatorOn(credential: string, pin: string): Promise<ActorContext> {
  const res = await pinLogin(pool, { terminalCredential: credential, pin });
  if (res.result.outcome !== 'resolved' || !res.operatorToken) throw new Error('pin login failed');
  const a = await loadOperatorContext(pool, res.operatorToken);
  if (!a) throw new Error('no operator');
  return a;
}

function bill(op: ActorContext, key: string) {
  return createBill(pool, op, {
    idempotencyKey: `mt-${S}-${key}`,
    menuVersion,
    paymentMethod: 'cash',
    lines: [{ catalogItemId: itemId, quantity: 1, addons: [] }],
    terminalOccurredAt: new Date().toISOString(),
  });
}

describe.skipIf(!RUN)('Parallel billing terminals', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);
    const brand = randomUUID();
    const franchiseId = randomUUID();
    outletId = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'MT Brand', true)`,
      [brand, ORG, `mt-brand-${S}`],
    );
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, ORG, brand, `mt-${S}`, `mt-${S}`],
    );
    await pool.query(
      `insert into billing.outlets
         (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug,
          billing_enabled)
       values ($1,$2,$3,$4,'franchise_owned','active',$5,$6,true)`,
      [outletId, ORG, brand, franchiseId, `MtOut${S.slice(-4)}`, `mtout-${S}`],
    );
    const adminPhone = `+9171${S.slice(-8).padStart(8, '0')}`;
    const ownerPhone = `+9172${S.slice(-8).padStart(8, '0')}`;
    await seed(adminPhone, 'central_admin', brand, null);
    await seed(ownerPhone, 'franchise_owner', brand, franchiseId);
    const admin = await adminActor(adminPhone);
    owner = await adminActor(ownerPhone);
    itemId = (
      await createCatalogItem(pool, admin, {
        brandId: brand,
        name: `MT Chai ${S}`,
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
      notes: `mt-${S}`,
    });
    menuVersion = (await getPublishedMenu(pool, admin, outletId))?.version ?? '';
    for (const n of [1, 2]) {
      const pin = String(6100 + n * 7 + (Date.now() % 1000));
      pins.push(pin);
      await createEmployee(pool, owner, {
        outletId,
        fullName: `MT Staff ${String(n)}`,
        mobile: `+918${String(n)}${S.slice(-8).padStart(8, '0')}`,
        initialPin: pin,
      });
    }
  }, 90_000);

  afterAll(async () => {
    await pool.end();
  });

  it('runs two counters at once with separate receipt numbers and one cash drawer', async () => {
    const a = await addTerminal('Counter 1');
    const b = await addTerminal('Counter 2');
    expect([a.receiptPrefix, b.receiptPrefix]).toEqual(['T01', 'T02']);
    const active = (await listTerminals(pool, owner, outletId)).filter(
      (t) => t.status !== 'revoked',
    );
    expect(active).toHaveLength(2);

    const opA = await operatorOn(a.terminalCredential, pins[0] ?? '');
    const opB = await operatorOn(b.terminalCredential, pins[1] ?? '');
    await openCashSession(pool, opA, { openingCash: '1000.00' });
    await startShift(pool, opA, {});
    await startShift(pool, opB, {});

    // Bill on both counters at the same time.
    const bills = await Promise.all(
      Array.from({ length: 6 }, (_, i) => bill(i % 2 ? opB : opA, `p${String(i)}`)),
    );
    const numbers = bills.map((x) => x.receiptNumber);
    expect(new Set(numbers).size).toBe(6);
    const seqs = (prefix: string) =>
      numbers
        .filter((n) => n.includes(`-${prefix}-`))
        .map((n) => Number(n.slice(-6)))
        .sort((x, y) => x - y);
    expect(seqs('T01')).toEqual([1, 2, 3]);
    expect(seqs('T02')).toEqual([1, 2, 3]);

    // Both counters' cash lands in the one open drawer.
    const sessions = await pool.query<{ n: number }>(
      `select count(distinct cash_session_id)::int n from billing.payments p
         join billing.bills b on b.id = p.bill_id where b.outlet_id = $1`,
      [outletId],
    );
    expect(sessions.rows[0]?.n).toBe(1);
  });

  it('replaces one counter without touching the other and continues its numbers', async () => {
    const before = (await listTerminals(pool, owner, outletId)).filter(
      (t) => t.status !== 'revoked',
    );
    const t01 = before.find((t) => t.receiptPrefix === 'T01');
    const t02 = before.find((t) => t.receiptPrefix === 'T02');
    expect(t01 && t02).toBeTruthy();
    const replacement = await addTerminal('Counter 1 (new tablet)', t01?.id);
    expect(replacement.receiptPrefix).toBe('T01');
    const after = await listTerminals(pool, owner, outletId);
    expect(after.find((t) => t.id === t01?.id)?.status).toBe('revoked');
    expect(after.find((t) => t.id === t02?.id)?.status).toBe('active');

    const op = await operatorOn(replacement.terminalCredential, pins[0] ?? '');
    await startShift(pool, op, {});
    const next = await bill(op, 'after-replace');
    expect(next.receiptNumber).toMatch(/-T01-000004$/);
  });

  it('limits counters per outlet and frees a slot when one is removed', async () => {
    const live = () =>
      listTerminals(pool, owner, outletId).then((t) => t.filter((x) => x.status !== 'revoked'));
    while ((await live()).length < MAX_TERMINALS_PER_OUTLET)
      await addTerminal(`Extra ${String((await live()).length)}`);
    await expect(
      issueActivationCode(pool, owner, { outletId, label: 'One too many', expiresInMinutes: 60 }),
    ).rejects.toThrow(/already has 10/);

    const extra = (await live()).find((t) => t.name.startsWith('Extra'));
    await revokeTerminal(pool, owner, extra?.id ?? '', 'not needed');
    const again = await addTerminal('Reuse slot');
    expect(again.receiptPrefix).toBe(extra?.receiptPrefix);

    await expect(
      issueActivationCode(pool, owner, {
        outletId,
        label: 'Bad replace',
        expiresInMinutes: 60,
        replacesTerminalId: randomUUID(),
      }),
    ).rejects.toThrow(/not active at this outlet/);
  });
});
