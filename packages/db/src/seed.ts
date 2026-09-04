import type { Pool } from 'pg';

const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';
const DEMO_FRANCHISE = '11111111-1111-4111-8111-111111111111';
const DEMO_OUTLET = '22222222-2222-4222-8222-222222222222';

/**
 * Development-only demo data. Reference data (roles, capabilities, the JKSH
 * organization, TVANAMM/T Leaf brands) ships as migrations. This adds a demo
 * franchise + active outlet and, when BOOTSTRAP_*_PHONE is set, ready-to-use
 * OTP login accounts. Refuses to run when NODE_ENV=production.
 */
export async function seedDevData(pool: Pool): Promise<{ seeded: boolean }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seedDevData must not run in production');
  }

  await pool.query(
    `insert into billing.franchises (id, organization_id, brand_id, name, slug)
     values ($1,$2,$3,'Demo Franchise','demo-franchise')
     on conflict (id) do nothing`,
    [DEMO_FRANCHISE, JKSH_ORG, TVANAMM_BRAND],
  );

  await pool.query(
    `insert into billing.outlets
       (id, organization_id, brand_id, franchise_id, ownership_type, status,
        display_name, slug, phone, address_line, city, state, postal_code, timezone,
        billing_enabled)
     values ($1,$2,$3,$4,'franchise_owned','active','Demo Outlet - Kukatpally',
             'demo-outlet-kukatpally','+914012345678','Plot 1, KPHB','Hyderabad',
             'Telangana','500072','Asia/Kolkata', true)
     on conflict (id) do nothing`,
    [DEMO_OUTLET, JKSH_ORG, TVANAMM_BRAND, DEMO_FRANCHISE],
  );

  const adminPhone = process.env.BOOTSTRAP_ADMIN_PHONE;
  if (adminPhone) {
    await upsertOtpAccount(pool, {
      phone: adminPhone,
      displayName: 'Bootstrap Central Admin',
      isInternal: true,
      role: 'central_admin',
      brandId: null,
      franchiseId: null,
    });
  }
  const ownerPhone = process.env.BOOTSTRAP_OWNER_PHONE;
  if (ownerPhone) {
    await upsertOtpAccount(pool, {
      phone: ownerPhone,
      displayName: 'Bootstrap Franchise Owner',
      isInternal: false,
      role: 'franchise_owner',
      brandId: TVANAMM_BRAND,
      franchiseId: DEMO_FRANCHISE,
    });
  }

  return { seeded: true };
}

async function upsertOtpAccount(
  pool: Pool,
  params: {
    phone: string;
    displayName: string;
    isInternal: boolean;
    role: 'central_admin' | 'accountant' | 'franchise_owner';
    brandId: string | null;
    franchiseId: string | null;
  },
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.account_profiles (mobile, display_name, status, is_internal, activated_at)
     values ($1,$2,'active',$3, now())
     on conflict (mobile) do update set display_name = excluded.display_name, status = 'active'
     returning id`,
    [params.phone, params.displayName, params.isInternal],
  );
  const accountId = rows[0]?.id;
  if (!accountId) return;
  await pool.query(
    `insert into identity.memberships (account_id, role_key, organization_id, brand_id, franchise_id)
     values ($1,$2,$3,$4,$5) on conflict do nothing`,
    [accountId, params.role, JKSH_ORG, params.brandId, params.franchiseId],
  );
}
