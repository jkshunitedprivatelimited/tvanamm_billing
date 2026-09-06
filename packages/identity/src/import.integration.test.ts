/**
 * Bulk import - preview never writes, confirm creates an immutable job with
 * per-row results, cross-tenant/duplicate rows are errors, retry is
 * idempotent (`bulk-import-and-data-quality.md`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import { previewImport, confirmImport, getImportJob } from './import';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerPhone: string;
let brand: string;
let otherOrgBrand: string;
let franchiseId: string;

async function seedAccount(phone: string, role: string, fId: string | null): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active'
     returning id`,
    [phone, `Imp ${role}`, role === 'central_admin'],
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

describe.skipIf(!RUN)('Bulk import', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name, is_billing_enabled)
       values ($1,$2,$3,'Import Test Brand', true)`,
      [brand, JKSH_ORG, `imp-brand-${S}`],
    );
    // A brand in a different organization, to prove cross-tenant rejection.
    const otherOrg = randomUUID();
    await pool.query(
      `insert into billing.organizations (id, name, slug) values ($1,'Other Org',$2)`,
      [otherOrg, `other-org-${S}`],
    );
    otherOrgBrand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name) values ($1,$2,$3,'Other Brand')`,
      [otherOrgBrand, otherOrg, `other-brand-${S}`],
    );
    adminPhone = `+9160${S.slice(-8).padStart(8, '0')}`;
    ownerPhone = `+9161${S.slice(-8).padStart(8, '0')}`;
    franchiseId = randomUUID();
    await pool.query(
      `insert into billing.franchises (id, organization_id, brand_id, name, slug)
       values ($1,$2,$3,$4,$5)`,
      [franchiseId, JKSH_ORG, brand, `imp-${S}`, `imp-${S}`],
    );
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerPhone, 'franchise_owner', franchiseId);
  }, 60_000);

  afterAll(async () => {
    try {
      await pool.query(
        `delete from billing.import_job_rows where import_job_id in
           (select id from billing.import_jobs where organization_id = $1 and template_version like $2)`,
        [JKSH_ORG, `t-${S}%`],
      );
      await pool.query(
        `delete from billing.import_jobs where organization_id = $1 and template_version like $2`,
        [JKSH_ORG, `t-${S}%`],
      );
      await pool.query(`delete from billing.catalog_items where brand_id = $1`, [brand]);
      await pool.query(`delete from billing.expense_categories where name like $1`, [
        `ImpCat ${S}%`,
      ]);
      await pool.query(`delete from billing.franchises where id = $1`, [franchiseId]);
      await pool.query(
        `delete from identity.memberships where account_id in
        (select id from identity.account_profiles where mobile = any($1::text[]))`,
        [[adminPhone, ownerPhone]],
      );
      await pool.query(`delete from identity.account_profiles where mobile = any($1::text[])`, [
        [adminPhone, ownerPhone],
      ]);
      await pool.query(`delete from billing.brands where id = any($1::uuid[])`, [
        [brand, otherOrgBrand],
      ]);
      await pool.query(`delete from billing.organizations where slug = $1`, [`other-org-${S}`]);
    } catch {
      /* best effort */
    }
    await pool.end();
  });

  it('preview classifies rows without writing; only Central may import', async () => {
    const admin = await adminActor(adminPhone);
    const preview = await previewImport(pool, admin, {
      kind: 'menu_item',
      brandId: brand,
      rows: [
        { name: `Imp Chai ${S}`, price: '15.00', gstRate: '5' },
        { name: `Imp Chai ${S}`, price: '16.00', gstRate: '5' }, // duplicate in file
      ],
    });
    expect(preview.createCount).toBe(1);
    expect(preview.errorCount).toBe(1);
    expect(preview.rows[1]!.error).toMatch(/duplicate/i);
    // Nothing was written.
    const cnt = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.catalog_items where brand_id = $1`,
      [brand],
    );
    expect(Number(cnt.rows[0]!.n)).toBe(0);

    const owner = await adminActor(ownerPhone);
    await expect(
      previewImport(pool, owner, {
        kind: 'menu_item',
        brandId: brand,
        rows: [{ name: 'x', price: '1.00', gstRate: '5' }],
      }),
    ).rejects.toThrow(/Denied/);
  }, 30_000);

  it('confirm creates an immutable job, per-row results, and rejects a cross-tenant brand row', async () => {
    const admin = await adminActor(adminPhone);
    const job = await confirmImport(pool, admin, {
      kind: 'menu_item',
      brandId: brand,
      templateVersion: `t-${S}-v1`,
      fileChecksum: 'sha256:abc',
      rows: [
        { name: `Imp Coffee ${S}`, price: '25.00', gstRate: '5', hsnCode: '2101' },
        { name: `Imp Vada ${S}`, price: '18.00', gstRate: '12' },
      ],
    });
    expect(job.status).toBe('completed');
    expect(job.createCount).toBe(2);
    expect(job.rows.every((r) => r.createdEntityId)).toBe(true);

    const fetched = await getImportJob(pool, admin, job.id);
    expect(fetched.rowCount).toBe(2);
    expect(fetched.rows).toHaveLength(2);

    // Re-running the same rows now classifies them as updates, not
    // duplicate creates - retry does not duplicate successful rows.
    const rerun = await confirmImport(pool, admin, {
      kind: 'menu_item',
      brandId: brand,
      templateVersion: `t-${S}-v2`,
      rows: [{ name: `Imp Coffee ${S}`, price: '26.00', gstRate: '5' }],
    });
    expect(rerun.updateCount).toBe(1);
    expect(rerun.createCount).toBe(0);
    const cnt = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.catalog_items where brand_id = $1 and name = $2`,
      [brand, `Imp Coffee ${S}`],
    );
    expect(Number(cnt.rows[0]!.n)).toBe(1);

    // A brand in another organization is an error row, not a silent write.
    const bad = await confirmImport(pool, admin, {
      kind: 'menu_item',
      brandId: otherOrgBrand,
      templateVersion: `t-${S}-v3`,
      rows: [{ name: `Imp Sneaky ${S}`, price: '9.00', gstRate: '5' }],
    });
    expect(bad.status).toBe('failed');
    expect(bad.rows[0]!.error).toMatch(/outside your organization/i);
  }, 30_000);

  it('imports expense categories, skipping ones that already exist', async () => {
    const admin = await adminActor(adminPhone);
    const first = await confirmImport(pool, admin, {
      kind: 'expense_category',
      templateVersion: `t-${S}-c1`,
      rows: [{ name: `ImpCat ${S} Cleaning` }, { name: `ImpCat ${S} Transport` }],
    });
    expect(first.createCount).toBe(2);
    const second = await confirmImport(pool, admin, {
      kind: 'expense_category',
      templateVersion: `t-${S}-c2`,
      rows: [{ name: `ImpCat ${S} Cleaning` }, { name: `ImpCat ${S} Repairs` }],
    });
    expect(second.skipCount).toBe(1);
    expect(second.createCount).toBe(1);
  }, 30_000);
});
