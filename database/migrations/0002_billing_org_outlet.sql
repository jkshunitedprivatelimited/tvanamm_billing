-- Stage 1 - Organization, brand, franchise, and outlet model.
-- docs/plans/billing-data-api-plan.md §4 ; docs/architecture/outlet-onboarding.md

create table billing.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,48}$'),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger organizations_set_updated_at before update on billing.organizations
  for each row execute function identity.set_updated_at();

create table billing.brands (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references billing.organizations(id) on delete restrict,
  slug               text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,48}$'),
  name               text not null,
  is_billing_enabled boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index brands_organization_id_idx on billing.brands(organization_id);
create trigger brands_set_updated_at before update on billing.brands
  for each row execute function identity.set_updated_at();

-- Customer ownership grouping. jksh_owned outlets have no franchise.
create table billing.franchises (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references billing.organizations(id) on delete restrict,
  brand_id        uuid not null references billing.brands(id) on delete restrict,
  name            text not null,
  slug            text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,64}$'),
  status          text not null default 'active' check (status in ('active','suspended','closed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index franchises_organization_id_idx on billing.franchises(organization_id);
create index franchises_brand_id_idx on billing.franchises(brand_id);
create trigger franchises_set_updated_at before update on billing.franchises
  for each row execute function identity.set_updated_at();

create type billing.outlet_ownership as enum ('jksh_owned', 'franchise_owned');
create type billing.outlet_status    as enum ('draft', 'active', 'suspended', 'closed');

-- Only Central Admin creates, suspends, closes, or reactivates outlets.
create table billing.outlets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references billing.organizations(id) on delete restrict,
  brand_id         uuid not null references billing.brands(id) on delete restrict,
  franchise_id     uuid references billing.franchises(id) on delete restrict,
  ownership_type   billing.outlet_ownership not null,
  status           billing.outlet_status not null default 'draft',

  display_name     text not null,
  legal_name       text,
  slug             text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,64}$'),
  phone            text not null default '',
  gstin            text,                          -- optional; never blocks activation
  address_line     text not null default '',
  city             text not null default '',
  state            text not null default '',
  postal_code      text not null default '',
  country          text not null default 'IN',
  -- IANA zone; the server uses this for business-date calculations, never the browser clock.
  timezone         text not null default 'Asia/Kolkata',
  receipt_config   jsonb not null default '{}'::jsonb,
  payment_methods  text[] not null default array['cash','upi'],
  billing_enabled  boolean not null default false,

  created_by       uuid,
  managed_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  suspended_at     timestamptz,
  closed_at        timestamptz,

  constraint outlets_ownership_shape check (
    (ownership_type = 'franchise_owned' and franchise_id is not null) or
    (ownership_type = 'jksh_owned'      and franchise_id is null)
  )
);
create index outlets_organization_id_idx on billing.outlets(organization_id);
create index outlets_franchise_id_idx on billing.outlets(franchise_id) where franchise_id is not null;
create index outlets_status_idx on billing.outlets(status);
create trigger outlets_set_updated_at before update on billing.outlets
  for each row execute function identity.set_updated_at();
