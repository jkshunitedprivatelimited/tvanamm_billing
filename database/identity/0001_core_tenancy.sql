-- Stage 1 - Foundation and Identity
-- Core tenancy: organizations -> brands -> franchises -> outlets.

create schema if not exists identity;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Shared updated_at trigger.
create or replace function identity.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Organizations: the top-level company boundary. JKSH is the only one for MVP.
create table identity.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,48}$'),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger organizations_set_updated_at
  before update on identity.organizations
  for each row execute function identity.set_updated_at();

-- Brands under an organization (TVANAMM, T Leaf). Billing is enabled per brand.
create table identity.brands (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references identity.organizations(id) on delete restrict,
  slug                text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,48}$'),
  name                text not null,
  is_billing_enabled  boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index brands_organization_id_idx on identity.brands(organization_id);
create trigger brands_set_updated_at
  before update on identity.brands
  for each row execute function identity.set_updated_at();

-- Franchises: the business-ownership boundary. A Franchise Owner is scoped here.
create table identity.franchises (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references identity.organizations(id) on delete restrict,
  brand_id         uuid not null references identity.brands(id) on delete restrict,
  name             text not null,
  slug             text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,64}$'),
  status           text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index franchises_organization_id_idx on identity.franchises(organization_id);
create index franchises_brand_id_idx on identity.franchises(brand_id);
create trigger franchises_set_updated_at
  before update on identity.franchises
  for each row execute function identity.set_updated_at();

-- Outlets: the physical billing location. A Store Employee belongs to exactly one.
create table identity.outlets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references identity.organizations(id) on delete restrict,
  franchise_id     uuid not null references identity.franchises(id) on delete restrict,
  name             text not null,
  slug             text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,64}$'),
  address          text not null default '',
  phone            text not null default '',
  -- IANA zone; the server uses this for business-date calculations, never the browser clock.
  timezone         text not null default 'Asia/Kolkata',
  status           text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  -- Centrally configured receipt header material (legal name, GSTIN, footer text).
  receipt_config   jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index outlets_organization_id_idx on identity.outlets(organization_id);
create index outlets_franchise_id_idx on identity.outlets(franchise_id);
create trigger outlets_set_updated_at
  before update on identity.outlets
  for each row execute function identity.set_updated_at();
