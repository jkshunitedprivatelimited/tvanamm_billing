-- Stage 1 - Accounts, roles, capabilities, memberships, invitations.
-- docs/plans/billing-data-api-plan.md §3

create type identity.account_status as enum
  ('invited', 'active', 'suspended', 'locked', 'closed');

-- Links a Supabase Auth user (mobile OTP identity) to the application. Central
-- Admin, Accountant, and Franchise Owner only. Store Employees are separate.
create table identity.account_profiles (
  id             uuid primary key default gen_random_uuid(),
  auth_user_id   uuid unique,                    -- auth.users.id, linked on first OTP verify
  mobile         text not null,                  -- normalized E.164
  display_name   text not null,
  email          citext,
  status         identity.account_status not null default 'invited',
  is_internal    boolean not null default false, -- JKSH staff vs tenant
  created_by     uuid references identity.account_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  activated_at   timestamptz,
  suspended_at   timestamptz,
  closed_at      timestamptz,
  constraint account_profiles_one_mobile unique (mobile)
);
create trigger account_profiles_set_updated_at before update on identity.account_profiles
  for each row execute function identity.set_updated_at();

-- Assignable membership roles. Store Employees are NOT a membership role
-- (their capabilities come from the operator-session path).
create table identity.roles (
  key         text primary key,
  description text not null
);

create table identity.capabilities (
  key         text primary key,
  description text not null
);

create table identity.role_capabilities (
  role_key       text not null references identity.roles(key) on delete cascade,
  capability_key text not null references identity.capabilities(key) on delete cascade,
  primary key (role_key, capability_key)
);

create type identity.membership_status as enum ('active', 'suspended', 'revoked');

-- Connects an account + role to an org/brand/franchise/outlet scope.
create table identity.memberships (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references identity.account_profiles(id) on delete cascade,
  role_key         text not null references identity.roles(key) on delete restrict,
  organization_id  uuid not null references billing.organizations(id) on delete restrict,
  brand_id         uuid references billing.brands(id) on delete restrict,
  franchise_id     uuid references billing.franchises(id) on delete restrict,
  outlet_id        uuid references billing.outlets(id) on delete restrict,
  status           identity.membership_status not null default 'active',
  created_by       uuid references identity.account_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint memberships_scope_shape check (
    case role_key
      when 'central_admin'   then franchise_id is null and outlet_id is null
      when 'accountant'      then franchise_id is null and outlet_id is null
      when 'franchise_owner' then franchise_id is not null
      else false
    end
  )
);
create unique index memberships_account_scope_uniq on identity.memberships (
  account_id, role_key, organization_id,
  coalesce(franchise_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(outlet_id,    '00000000-0000-0000-0000-000000000000'::uuid)
);
create index memberships_account_id_idx on identity.memberships(account_id);
create index memberships_franchise_id_idx on identity.memberships(franchise_id) where franchise_id is not null;
create index memberships_outlet_id_idx on identity.memberships(outlet_id) where outlet_id is not null;
create trigger memberships_set_updated_at before update on identity.memberships
  for each row execute function identity.set_updated_at();

-- One-time Franchise Owner onboarding invitations (public self-registration off).
create type identity.invitation_status as enum
  ('pending', 'delivered', 'accepted', 'expired', 'cancelled');

create table identity.invitations (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references identity.account_profiles(id) on delete cascade,
  mobile       text not null,
  token_hash   text not null,
  status       identity.invitation_status not null default 'pending',
  expires_at   timestamptz not null,
  created_by   uuid references identity.account_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  accepted_at  timestamptz,
  cancelled_at timestamptz,
  resend_count integer not null default 0
);
create index invitations_account_id_idx on identity.invitations(account_id);
create index invitations_open_idx on identity.invitations(expires_at)
  where status in ('pending', 'delivered');

-- Compensating control for the MVP's single factor: our own resend cooldown /
-- attempt cap layered in front of the provider (advanced-login.md).
create table identity.otp_attempts (
  mobile              text primary key,
  sent_count          integer not null default 0,
  last_sent_at        timestamptz,
  verify_failed_count integer not null default 0,
  last_failed_at      timestamptz,
  locked_until        timestamptz,
  window_started_at   timestamptz not null default now()
);
