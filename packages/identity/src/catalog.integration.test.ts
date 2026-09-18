/**
 * Billing V1 Stage 1 - catalog authoring + immutable menu publication, against a
 * real Postgres. Runs only when DATABASE_URL is set.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from '@jksh/db';
import { migrate } from '@jksh/db/migrate';
import type { ActorContext } from '@jksh/contracts';
import { resolveAdminAfterVerify, buildAdminActor } from './admin-auth';
import {
  createCatalogItem,
  updateCatalogItem,
  upsertOutletItemOverride,
  listOutletMenuForPricing,
} from './catalog';
import {
  createAndApplyPublication,
  getPublishedMenu,
  previewPublication,
  retryFailedTargets,
} from './menu-publish';
import { createTaxProfile } from './tax-profile';

const RUN = !!process.env.DATABASE_URL;
const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const S = Date.now().toString(36);

let pool: Pool;
let adminPhone: string;
let ownerAPhone: string;
let ownerBPhone: string;
let franchiseA: string;
let franchiseB: string;
let outletA: string;
let outletB: string;
let brand: string;

async function seedAccount(phone: string, role: string, franchiseId: string | null): Promise<void> {
  const internal = role === 'central_admin';
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3,now())
     on conflict (mobile) do update set status='active', is_internal=excluded.is_internal
     returning id`,
    [phone, `Cat ${role}`, internal],
  );
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, brand_id, franchise_id)
     values ($1,$2,$3,$4,$5) on conflict do nothing`,
    [rows[0]!.id, role, JKSH_ORG, franchiseId ? brand : null, franchiseId],
  );
}

async function actorFor(phone: string): Promise<ActorContext> {
  const authUserId = randomUUID();
  const r = await resolveAdminAfterVerify(pool, { authUserId, phone });
  if (r.result.outcome !== 'single_workspace') throw new Error('expected single workspace');
  const actor = await buildAdminActor(pool, { authUserId, membershipId: r.result.membershipId });
  if (!actor) throw new Error('no actor');
  return actor;
}

async function makeOutlet(franchiseId: string, label: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into billing.outlets
       (id, organization_id, brand_id, franchise_id, ownership_type, status, display_name, slug)
     values ($1,$2,$3,$4,'franchise_owned','active',$5,$6)`,
    [id, JKSH_ORG, brand, franchiseId, label, `${label.toLowerCase()}-${S}`],
  );
  return id;
}

describe.skipIf(!RUN)('Billing V1 Stage 1 - catalog + publication', () => {
  beforeAll(async () => {
    pool = createPool(process.env.DATABASE_URL);
    await migrate(pool);

    // A throwaway brand so the master menu is fully isolated per run.
    brand = randomUUID();
    await pool.query(
      `insert into billing.brands (id, organization_id, slug, name)
       values ($1,$2,$3,'Catalog Test Brand')`,
      [brand, JKSH_ORG, `cat-brand-${S}`],
    );

    adminPhone = `+9197${S.slice(-8).padStart(8, '0')}`;
    ownerAPhone = `+9196${S.slice(-8).padStart(8, '0')}`;
    ownerBPhone = `+9195${S.slice(-8).padStart(8, '0')}`;
    franchiseA = randomUUID();
    franchiseB = randomUUID();
    for (const [id, n] of [
      [franchiseA, `cata-${S}`],
      [franchiseB, `catb-${S}`],
    ] as const) {
      await pool.query(
        `insert into billing.franchises (id, organization_id, brand_id, name, slug)
         values ($1,$2,$3,$4,$5)`,
        [id, JKSH_ORG, brand, n, n],
      );
    }
    await seedAccount(adminPhone, 'central_admin', null);
    await seedAccount(ownerAPhone, 'franchise_owner', franchiseA);
    await seedAccount(ownerBPhone, 'franchise_owner', franchiseB);
    outletA = await makeOutlet(franchiseA, `CatOutA${S.slice(-4)}`);
    outletB = await makeOutlet(franchiseB, `CatOutB${S.slice(-4)}`);
  }, 60_000);

  afterAll(async () => {
    try {
      for (const o of [outletA, outletB]) {
        await pool.query(
          `delete from billing.outlet_menu_version_items where outlet_menu_version_id in
             (select id from billing.outlet_menu_versions where outlet_id = $1)`,
          [o],
        );
        await pool.query(`delete from billing.outlet_menu_versions where outlet_id = $1`, [o]);
      }
      await pool.query(
        `delete from billing.menu_publication_targets where outlet_id = any($1::uuid[])`,
        [[outletA, outletB]],
      );
      await pool.query(`delete from billing.menu_publications where brand_id = $1 and notes = $2`, [
        brand,
        `stage1-${S}`,
      ]);
      await pool.query(
        `delete from billing.outlet_item_overrides where outlet_id = any($1::uuid[])`,
        [[outletA, outletB]],
      );
      // catalog_price_history is append-only (no FK, DELETE trigger) - left as-is.
      await pool.query(`delete from billing.catalog_items where name like $1`, [`%${S}%`]);
      await pool.query(`delete from billing.outlets where id = any($1::uuid[])`, [
        [outletA, outletB],
      ]);
      await pool.query(`delete from identity.memberships where franchise_id = any($1::uuid[])`, [
        [franchiseA, franchiseB],
      ]);
      await pool.query(`delete from billing.franchises where id = any($1::uuid[])`, [
        [franchiseA, franchiseB],
      ]);
      await pool.query(`delete from identity.account_profiles where mobile = any($1::text[])`, [
        [adminPhone, ownerAPhone, ownerBPhone],
      ]);
      await pool.query(`delete from billing.catalog_items where brand_id = $1`, [brand]);
      await pool.query(`delete from billing.tax_profiles where brand_id = $1`, [brand]);
      await pool.query(`delete from billing.brands where id = $1`, [brand]);
    } catch {
      /* best effort */
    }
    await pool.end();
  });

  it('denies a Franchise Owner authoring a private item for another franchise outlet', async () => {
    const admin = await actorFor(adminPhone);
    const profile = await createTaxProfile(pool, admin, {
      brandId: brand,
      name: `Standard 5% ${S}`,
      hsnCode: '2101',
      gstRate: '5',
    });
    const ownerB = await actorFor(ownerBPhone);
    await expect(
      createCatalogItem(pool, ownerB, {
        brandId: brand,
        outletId: outletA, // belongs to franchise A
        name: 'Sneaky Samosa',
        taxProfileId: profile.id,
        price: '20.00',
        isAvailable: true,
        offlineSaleAllowed: true,
        addonGroupIds: [],
      }),
    ).rejects.toThrow(/Denied|row-level security/);
  });

  it('publishes a master menu atomically and POS reads only the complete version', async () => {
    const admin = await actorFor(adminPhone);
    // No publication yet -> POS sees nothing.
    expect(await getPublishedMenu(pool, admin, outletA)).toBeNull();

    const a = await createCatalogItem(pool, admin, {
      brandId: brand,
      name: `Masala Chai ${S}`,
      gstRate: '5',
      price: '15.00',
      isAvailable: true,
      offlineSaleAllowed: true,
      addonGroupIds: [],
    });
    await createCatalogItem(pool, admin, {
      brandId: brand,
      name: `Filter Coffee ${S}`,
      gstRate: '5',
      price: '25.00',
      isAvailable: true,
      offlineSaleAllowed: true,
      addonGroupIds: [],
    });

    const res = await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletA, outletB],
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    expect(res.status).toBe('completed');
    expect(res.targets).toHaveLength(2);

    const menuA = await getPublishedMenu(pool, admin, outletA);
    expect(menuA?.items.length).toBe(2);
    expect(menuA?.items.map((i) => i.name).sort()).toEqual(
      [`Filter Coffee ${S}`, `Masala Chai ${S}`].sort(),
    );
    // exactly one current version per outlet
    const cur = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.outlet_menu_versions where outlet_id = $1 and is_current`,
      [outletA],
    );
    expect(Number(cur.rows[0]!.n)).toBe(1);

    // Draft isolation: editing the master item does not touch the published version.
    await updateCatalogItem(pool, admin, a.id, { price: '18.00' });
    const menuStill = await getPublishedMenu(pool, admin, outletA);
    expect(menuStill?.items.find((i) => i.name === `Masala Chai ${S}`)?.price).toBe('15.00');
  }, 60_000);

  it('preserves an outlet price override, and only an explicit overwrite clears it', async () => {
    const admin = await actorFor(adminPhone);
    const ownerA = await actorFor(ownerAPhone);
    const item = await createCatalogItem(pool, admin, {
      brandId: brand,
      name: `Cutting ${S}`,
      gstRate: '5',
      price: '10.00',
      isAvailable: true,
      offlineSaleAllowed: true,
      addonGroupIds: [],
    });
    await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletA],
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });

    // Owner A sets an outlet selling price, then publishes their outlet.
    await upsertOutletItemOverride(pool, ownerA, {
      outletId: outletA,
      catalogItemId: item.id,
      price: '12.00',
    });
    await createAndApplyPublication(pool, ownerA, {
      brandId: brand,
      scope: 'outlet',
      originOutletId: outletA,
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    let menu = await getPublishedMenu(pool, admin, outletA);
    expect(menu?.items.find((i) => i.name === `Cutting ${S}`)?.price).toBe('12.00');

    // A normal master publish must NOT overwrite the outlet's price.
    await updateCatalogItem(pool, admin, item.id, { price: '11.00' });
    await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletA],
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    menu = await getPublishedMenu(pool, admin, outletA);
    expect(menu?.items.find((i) => i.name === `Cutting ${S}`)?.price).toBe('12.00');

    // An explicit price overwrite clears the override and applies the master price.
    await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletA],
      overwritePrice: true,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    menu = await getPublishedMenu(pool, admin, outletA);
    expect(menu?.items.find((i) => i.name === `Cutting ${S}`)?.price).toBe('11.00');
    const ov = await pool.query<{ price: string | null }>(
      `select price from billing.outlet_item_overrides where outlet_id = $1 and catalog_item_id = $2`,
      [outletA, item.id],
    );
    expect(ov.rows[0]?.price).toBeNull();
  }, 60_000);

  it('retry is idempotent: an already-applied target is skipped with no new version', async () => {
    const admin = await actorFor(adminPhone);
    await createCatalogItem(pool, admin, {
      brandId: brand,
      name: `Retry Item ${S}`,
      gstRate: '5',
      price: '30.00',
      isAvailable: true,
      offlineSaleAllowed: true,
      addonGroupIds: [],
    });
    const res = await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletB],
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    expect(res.status).toBe('completed');
    const before = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.outlet_menu_versions where outlet_id = $1`,
      [outletB],
    );
    const retry = await retryFailedTargets(pool, admin, res.publicationId);
    expect(retry.status).toBe('completed');
    const after = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.outlet_menu_versions where outlet_id = $1`,
      [outletB],
    );
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n));
  }, 60_000);

  it('published version items and price history are immutable', async () => {
    await expect(
      pool.query(
        `update billing.outlet_menu_version_items set price = '999.00'
                   where outlet_menu_version_id in
                     (select id from billing.outlet_menu_versions where outlet_id = $1)`,
        [outletA],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query(`delete from billing.catalog_price_history where scope = 'master_item'`),
    ).rejects.toThrow(/append-only|immutable|reject/i);
  });

  it('preview reports which targets would change without mutating anything', async () => {
    const admin = await actorFor(adminPhone);
    // Bring outletA fully up to date first.
    await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletA],
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    const versionsBefore = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.outlet_menu_versions where outlet_id = $1`,
      [outletA],
    );

    const clean = await previewPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletA],
      overwritePrice: false,
      forcedFields: [],
    });
    expect(clean.targets[0]!.outletId).toBe(outletA);
    expect(clean.targets[0]!.willChange).toBe(false);

    // A new master item makes the next publish a change; preview must show it.
    await createCatalogItem(pool, admin, {
      brandId: brand,
      name: `Preview Item ${S}`,
      gstRate: '5',
      price: '9.00',
      isAvailable: true,
      offlineSaleAllowed: true,
      addonGroupIds: [],
    });
    const dirty = await previewPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      targetOutletIds: [outletA],
      overwritePrice: false,
      forcedFields: [],
    });
    expect(dirty.targets[0]!.willChange).toBe(true);

    // Preview created no version.
    const versionsAfter = await pool.query<{ n: string }>(
      `select count(*)::int as n from billing.outlet_menu_versions where outlet_id = $1`,
      [outletA],
    );
    expect(Number(versionsAfter.rows[0]!.n)).toBe(Number(versionsBefore.rows[0]!.n));
  }, 30_000);

  it('requires a Franchise-created item to reference a Central-approved tax profile', async () => {
    const admin = await actorFor(adminPhone);
    const ownerA = await actorFor(ownerAPhone);
    const profile = await createTaxProfile(pool, admin, {
      brandId: brand,
      name: `Snacks 12% ${S}`,
      hsnCode: '2106',
      gstRate: '12',
    });
    const item = await createCatalogItem(pool, ownerA, {
      brandId: brand,
      outletId: outletA, // this is the last test in the file - safe to leave live
      name: `Owner Vada ${S}`,
      taxProfileId: profile.id,
      price: '18.00',
      isAvailable: true,
      offlineSaleAllowed: true,
      addonGroupIds: [],
    });
    const row = await pool.query<{ gst_rate: string; hsn_code: string; tax_profile_id: string }>(
      `select gst_rate, hsn_code, tax_profile_id from billing.catalog_items where id = $1`,
      [item.id],
    );
    expect(row.rows[0]?.gst_rate).toBe('12.00');
    expect(row.rows[0]?.hsn_code).toBe('2106');
    expect(row.rows[0]?.tax_profile_id).toBe(profile.id);

    // A Franchise Owner cannot manage tax profiles - only Central can.
    await expect(
      createTaxProfile(pool, ownerA, {
        brandId: brand,
        name: 'Owner attempted profile',
        hsnCode: '9999',
        gstRate: '18',
      }),
    ).rejects.toThrow(/Denied/);
  });
  it('shows outlet names, publishes removal/restoration only to that outlet and keeps master history', async () => {
    const admin = await actorFor(adminPhone);
    const ownerA = await actorFor(ownerAPhone);
    const ownerB = await actorFor(ownerBPhone);
    const item = await createCatalogItem(pool, admin, {
      brandId: brand,
      name: `Scoped Tea ${S}`,
      price: '25.00',
      gstRate: '5',
      isAvailable: true,
      offlineSaleAllowed: true,
      addonGroupIds: [],
    });
    await createAndApplyPublication(pool, admin, {
      brandId: brand,
      scope: 'master',
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    const old = await getPublishedMenu(pool, admin, outletA);
    await upsertOutletItemOverride(pool, ownerA, {
      outletId: outletA,
      catalogItemId: item.id,
      name: `Owner Tea ${S}`,
      price: '30.00',
      isAvailable: false,
    });
    const own = (await listOutletMenuForPricing(pool, ownerA, outletA)).items.find(
      (i) => i.catalogItemId === item.id,
    );
    expect(own?.name).toBe(`Owner Tea ${S}`);
    expect(own?.outletIsAvailable).toBe(false);
    const other = (await listOutletMenuForPricing(pool, ownerB, outletB)).items.find(
      (i) => i.catalogItemId === item.id,
    );
    expect(other?.name).toBe(`Scoped Tea ${S}`);
    expect(other?.outletPrice).toBeNull();
    await expect(
      upsertOutletItemOverride(pool, ownerA, {
        outletId: outletB,
        catalogItemId: item.id,
        name: 'Not allowed',
      }),
    ).rejects.toThrow();
    await createAndApplyPublication(pool, ownerA, {
      brandId: brand,
      scope: 'outlet',
      originOutletId: outletA,
      overwritePrice: false,
      forcedFields: [],
      notes: `stage1-${S}`,
    });
    const menu = await getPublishedMenu(pool, admin, outletA);
    expect(menu?.items.find((i) => i.catalogItemId === item.id)?.isAvailable).toBe(false);
    expect(menu?.items.find((i) => i.catalogItemId === item.id)?.name).toBe(`Owner Tea ${S}`);
    expect(old?.items.find((i) => i.catalogItemId === item.id)?.name).toBe(`Scoped Tea ${S}`);
    expect(
      (await getPublishedMenu(pool, admin, outletB))?.items.find((i) => i.catalogItemId === item.id)
        ?.isAvailable,
    ).toBe(true);
    await upsertOutletItemOverride(pool, ownerA, {
      outletId: outletA,
      catalogItemId: item.id,
      isAvailable: true,
    });
    expect(
      (await listOutletMenuForPricing(pool, ownerA, outletA)).items.find(
        (i) => i.catalogItemId === item.id,
      )?.outletIsAvailable,
    ).toBe(true);
  });
});
