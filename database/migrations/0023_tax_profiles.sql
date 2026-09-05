-- Central-approved GST/HSN tax profiles (`docs/architecture/menu-publishing.md`
-- "GST/HSN comes from a Central-approved tax profile rather than an arbitrary
-- rate entered at the outlet"). Central alone authors profiles; a
-- Franchise-created (outlet-owned) catalog item must reference one instead of
-- entering a free-text GST rate/HSN code. Central's own master items keep
-- entering GST/HSN directly - Central IS the tax-profile authority, so this
-- narrows the change to exactly the case the doc calls out.

create table billing.tax_profiles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references billing.organizations(id) on delete restrict,
  brand_id        uuid not null references billing.brands(id) on delete restrict,
  name            text not null check (length(btrim(name)) between 1 and 120),
  hsn_code        text not null check (length(btrim(hsn_code)) between 1 and 20),
  gst_rate        numeric(5,2) not null check (gst_rate >= 0 and gst_rate < 100),
  is_active       boolean not null default true,
  created_by      uuid references identity.account_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tax_profiles_brand_name_uniq unique (brand_id, name)
);
create index tax_profiles_brand_idx on billing.tax_profiles(brand_id);
create trigger tax_profiles_set_updated_at before update on billing.tax_profiles
  for each row execute function identity.set_updated_at();

alter table billing.tax_profiles enable row level security;
grant select, insert, update on billing.tax_profiles to identity_api;

-- Reference-like data (same idiom as `billing.brands`): any authenticated
-- identity_api session may read every profile. A Franchise Owner needs this
-- to populate the profile picker when creating an outlet item; write access
-- is what's actually restricted.
create policy tax_profiles_read on billing.tax_profiles for select to identity_api
  using (true);
create policy tax_profiles_write on billing.tax_profiles for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());

-- Franchise-created items reference an approved profile; Central's own master
-- items are unaffected and keep entering GST/HSN directly (nullable so
-- existing rows and master items never need one).
alter table billing.catalog_items
  add column tax_profile_id uuid references billing.tax_profiles(id) on delete restrict;

insert into identity.capabilities (key, description) values
  ('catalog.tax_profile.manage', 'Create and manage Central-approved GST/HSN tax profiles')
on conflict (key) do nothing;

insert into identity.role_capabilities (role_key, capability_key) values
  ('central_admin', 'catalog.tax_profile.manage')
on conflict (role_key, capability_key) do nothing;
