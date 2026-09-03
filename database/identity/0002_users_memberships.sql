-- Stage 1 - Users, account lifecycle, memberships, roles, permissions.

create type identity.account_state as enum (
  'invited', 'active', 'suspended', 'locked', 'disabled'
);

create type identity.role as enum (
  'central_admin', 'accountant', 'franchise_owner', 'store_employee'
);

create type identity.membership_status as enum ('active', 'suspended', 'revoked');

-- Application identity. For admin/owner users, `id` mirrors auth.users.id
-- (Supabase Auth via mobile SMS OTP). Store Employees are not Supabase Auth
-- users and get a generated id; they log in with a four-digit PIN on a terminal.
create table identity.users (
  id             uuid primary key default gen_random_uuid(),
  -- Supabase Auth user id, linked on first successful mobile OTP. Decoupled from
  -- `id` because Central Admin pre-creates the account before the owner ever
  -- authenticates (Confirmed Franchise Onboarding).
  auth_user_id   uuid,
  email          citext unique,
  full_name      text not null,
  -- E.164 mobile number. The login identity for OTP accounts; also captured for
  -- store employees. One phone identifies one OTP account.
  phone          text,
  account_state  identity.account_state not null default 'invited',
  -- true for JKSH staff (central_admin, accountant), false for tenant users.
  is_internal    boolean not null default false,
  -- true when the user authenticates via Supabase Auth (mobile OTP).
  has_auth_login boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  invited_at     timestamptz,
  activated_at   timestamptz,
  disabled_at    timestamptz,
  constraint users_phone_required_for_auth
    check (not has_auth_login or phone is not null)
);
-- One mobile number identifies one OTP account (deterministic OTP resolution).
create unique index users_phone_auth_uniq
  on identity.users(phone)
  where has_auth_login and phone is not null;
create unique index users_auth_user_id_uniq
  on identity.users(auth_user_id)
  where auth_user_id is not null;
create trigger users_set_updated_at
  before update on identity.users
  for each row execute function identity.set_updated_at();

-- Mobile OTP send/verify throttling, keyed by the entered phone number
-- (compensating control for the MVP's single factor).
create table identity.otp_attempts (
  phone               text primary key,
  sent_count          integer not null default 0,
  last_sent_at        timestamptz,
  verify_failed_count integer not null default 0,
  last_failed_at      timestamptz,
  locked_until        timestamptz,
  window_started_at   timestamptz not null default now()
);

-- Named responsibility bundles. Keys match identity.role.
create table identity.roles (
  key          text primary key,
  description  text not null
);

-- Granular capabilities. Keys match @jksh/contracts capabilitySchema.
create table identity.permissions (
  key          text primary key,
  description  text not null
);

create table identity.role_permissions (
  role_key        text not null references identity.roles(key) on delete cascade,
  permission_key  text not null references identity.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

-- Connects a user to a scope and a role. One user may hold several memberships.
create table identity.memberships (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references identity.users(id) on delete cascade,
  role             identity.role not null,
  organization_id  uuid not null references identity.organizations(id) on delete restrict,
  brand_id         uuid references identity.brands(id) on delete restrict,
  franchise_id     uuid references identity.franchises(id) on delete restrict,
  outlet_id        uuid references identity.outlets(id) on delete restrict,
  status           identity.membership_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references identity.users(id) on delete set null,

  -- Scope shape per role (docs/architecture/billing-actors.md).
  constraint memberships_scope_shape check (
    case role
      when 'central_admin'   then franchise_id is null and outlet_id is null
      when 'accountant'      then franchise_id is null and outlet_id is null
      when 'franchise_owner' then franchise_id is not null and outlet_id is null
      when 'store_employee'  then franchise_id is not null and outlet_id is not null
    end
  )
);
-- One membership per (user, role, exact scope). NULL franchise/outlet are
-- folded to the nil UUID so the uniqueness covers org-scoped roles too.
create unique index memberships_user_scope_uniq on identity.memberships (
  user_id,
  role,
  organization_id,
  coalesce(franchise_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index memberships_user_id_idx on identity.memberships(user_id);
create index memberships_organization_id_idx on identity.memberships(organization_id);
create index memberships_franchise_id_idx on identity.memberships(franchise_id)
  where franchise_id is not null;
create index memberships_outlet_id_idx on identity.memberships(outlet_id)
  where outlet_id is not null;
create trigger memberships_set_updated_at
  before update on identity.memberships
  for each row execute function identity.set_updated_at();

-- One-time Franchise Owner onboarding invitations. Public self-registration is
-- disabled; Central Admin creates the account + memberships, then invites.
create table identity.invitations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references identity.users(id) on delete cascade,
  phone          text not null,
  token_hash     text not null,
  expires_at     timestamptz not null,
  created_by     uuid references identity.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  cancelled_at   timestamptz,
  resent_count   integer not null default 0
);
create index invitations_user_id_idx on identity.invitations(user_id);
create index invitations_open_idx on identity.invitations(expires_at)
  where accepted_at is null and cancelled_at is null;
