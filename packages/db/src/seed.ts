import type { Pool } from 'pg';

const JKSH_ORG = '01000000-0000-4000-8000-000000000001';
const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';
const DEMO_FRANCHISE = '11111111-1111-4111-8111-111111111111';
const DEMO_OUTLET = '22222222-2222-4222-8222-222222222222';

/**
 * Development-only demo data. Reference data (roles, permissions, the JKSH
 * organization, the TVANAMM brand) ships as migrations and is always present;
 * this adds a throwaway franchise and outlet so a developer can exercise the
 * flows locally. Refuses to run when NODE_ENV=production.
 */
export async function seedDevData(pool: Pool): Promise<{ seeded: boolean }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seedDevData must not run in production');
  }

  await pool.query(
    `insert into identity.franchises (id, organization_id, brand_id, name, slug)
     values ($1, $2, $3, 'Demo Franchise', 'demo-franchise')
     on conflict (id) do nothing`,
    [DEMO_FRANCHISE, JKSH_ORG, TVANAMM_BRAND],
  );

  await pool.query(
    `insert into identity.outlets
       (id, organization_id, franchise_id, name, slug, address, phone, timezone)
     values ($1, $2, $3, 'Demo Outlet - Kukatpally', 'demo-outlet-kukatpally',
             'Plot 1, KPHB, Hyderabad, Telangana 500072', '+914012345678', 'Asia/Kolkata')
     on conflict (id) do nothing`,
    [DEMO_OUTLET, JKSH_ORG, DEMO_FRANCHISE],
  );

  // Optional bootstrap login accounts so the apps are usable locally.
  const adminPhone = process.env.BOOTSTRAP_ADMIN_PHONE;
  if (adminPhone) {
    await upsertOtpUser(pool, {
      phone: adminPhone,
      fullName: 'Bootstrap Central Admin',
      isInternal: true,
      role: 'central_admin',
      organizationId: JKSH_ORG,
    });
  }

  const ownerPhone = process.env.BOOTSTRAP_OWNER_PHONE;
  if (ownerPhone) {
    await upsertOtpUser(pool, {
      phone: ownerPhone,
      fullName: 'Bootstrap Franchise Owner',
      isInternal: false,
      role: 'franchise_owner',
      organizationId: JKSH_ORG,
      brandId: TVANAMM_BRAND,
      franchiseId: DEMO_FRANCHISE,
    });
  }

  return { seeded: true };
}

async function upsertOtpUser(
  pool: Pool,
  params: {
    phone: string;
    fullName: string;
    isInternal: boolean;
    role: 'central_admin' | 'accountant' | 'franchise_owner';
    organizationId: string;
    brandId?: string;
    franchiseId?: string;
  },
): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into identity.users (full_name, phone, account_state, is_internal, has_auth_login, activated_at)
     values ($1, $2, 'active', $3, true, now())
     on conflict (phone) where (has_auth_login and phone is not null)
       do update set full_name = excluded.full_name, account_state = 'active'
     returning id`,
    [params.fullName, params.phone, params.isInternal],
  );
  const userId = rows[0]?.id;
  if (!userId) return;
  await pool.query(
    `insert into identity.memberships
       (user_id, role, organization_id, brand_id, franchise_id, outlet_id)
     values ($1, $2, $3, $4, $5, null)
     on conflict do nothing`,
    [userId, params.role, params.organizationId, params.brandId ?? null, params.franchiseId ?? null],
  );
}
