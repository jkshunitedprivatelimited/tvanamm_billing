-- Billing V1 Stage 1 - Catalog authoring model.
-- docs/plans/billing-data-api-plan.md §5 ; docs/architecture/menu-publishing.md
--
-- Central Admin owns the master menu per brand. A Franchise Owner may author
-- private categories / items / add-on groups for ONE owned outlet, and may set
-- field-level overrides on a master item for an owned outlet. Prices are always
-- GST-inclusive decimals. No product variants in V1.

create type billing.catalog_owner_scope as enum ('master', 'outlet');
create type billing.catalog_status      as enum ('draft', 'active', 'archived');

-- ---- Categories ---------------------------------------------------------

create table billing.categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references billing.organizations(id) on delete restrict,
  brand_id        uuid not null references billing.brands(id) on delete restrict,
  owner_scope     billing.catalog_owner_scope not null,
  outlet_id       uuid references billing.outlets(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  display_order   integer not null default 0,
  status          billing.catalog_status not null default 'active',
  created_by      uuid references identity.account_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint categories_scope_shape check (
    (owner_scope = 'master' and outlet_id is null) or
    (owner_scope = 'outlet' and outlet_id is not null)
  )
);
create index categories_brand_idx on billing.categories(brand_id) where owner_scope = 'master';
create index categories_outlet_idx on billing.categories(outlet_id) where owner_scope = 'outlet';
create trigger categories_set_updated_at before update on billing.categories
  for each row execute function identity.set_updated_at();

-- ---- Add-on groups + add-ons -----------------------------------------

create table billing.addon_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references billing.organizations(id) on delete restrict,
  brand_id        uuid not null references billing.brands(id) on delete restrict,
  owner_scope     billing.catalog_owner_scope not null,
  outlet_id       uuid references billing.outlets(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  min_select      integer not null default 0 check (min_select >= 0),
  max_select      integer not null default 1 check (max_select >= 1),
  is_required     boolean not null default false,
  status          billing.catalog_status not null default 'active',
  created_by      uuid references identity.account_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint addon_groups_scope_shape check (
    (owner_scope = 'master' and outlet_id is null) or
    (owner_scope = 'outlet' and outlet_id is not null)
  ),
  constraint addon_groups_select_range check (max_select >= min_select),
  constraint addon_groups_required_min check (not is_required or min_select >= 1)
);
create trigger addon_groups_set_updated_at before update on billing.addon_groups
  for each row execute function identity.set_updated_at();

create table billing.addons (
  id              uuid primary key default gen_random_uuid(),
  addon_group_id  uuid not null references billing.addon_groups(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  price           numeric(12,2) not null default 0 check (price >= 0),
  gst_rate        numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate < 100),
  is_available    boolean not null default true,
  display_order   integer not null default 0,
  status          billing.catalog_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index addons_group_idx on billing.addons(addon_group_id);
create trigger addons_set_updated_at before update on billing.addons
  for each row execute function identity.set_updated_at();

-- ---- Catalog items ----------------------------------------------------

create table billing.catalog_items (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references billing.organizations(id) on delete restrict,
  brand_id              uuid not null references billing.brands(id) on delete restrict,
  owner_scope           billing.catalog_owner_scope not null,
  outlet_id             uuid references billing.outlets(id) on delete cascade,
  category_id           uuid references billing.categories(id) on delete set null,
  name                  text not null check (length(btrim(name)) between 1 and 160),
  description           text check (description is null or length(description) <= 2000),
  image_url             text,
  hsn_code              text,
  gst_rate              numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate < 100),
  price                 numeric(12,2) not null check (price >= 0),   -- GST-inclusive
  is_available          boolean not null default true,
  availability_note     text,
  stock_recipe_id       uuid,
  stock_recipe_version  integer,
  offline_sale_allowed  boolean not null default true,
  status                billing.catalog_status not null default 'active',
  -- Provenance for "copy outlet item to master".
  source_outlet_item_id uuid references billing.catalog_items(id) on delete set null,
  promoted_by           uuid references identity.account_profiles(id) on delete set null,
  created_by            uuid references identity.account_profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint catalog_items_scope_shape check (
    (owner_scope = 'master' and outlet_id is null) or
    (owner_scope = 'outlet' and outlet_id is not null)
  ),
  constraint catalog_items_recipe_pair check (
    (stock_recipe_id is null) = (stock_recipe_version is null)
  )
);
create index catalog_items_brand_idx on billing.catalog_items(brand_id) where owner_scope = 'master';
create index catalog_items_outlet_idx on billing.catalog_items(outlet_id) where owner_scope = 'outlet';
create index catalog_items_category_idx on billing.catalog_items(category_id);
create trigger catalog_items_set_updated_at before update on billing.catalog_items
  for each row execute function identity.set_updated_at();

-- Which add-on groups a catalog item offers (master items reference master
-- groups; outlet items reference master or same-outlet groups).
create table billing.item_addon_groups (
  catalog_item_id uuid not null references billing.catalog_items(id) on delete cascade,
  addon_group_id  uuid not null references billing.addon_groups(id) on delete cascade,
  display_order   integer not null default 0,
  primary key (catalog_item_id, addon_group_id)
);

-- ---- Outlet field-level overrides -----------------------------------
-- A NULL column means "inherit from master". `price` is only honoured when the
-- publication explicitly overwrote standard price OR the owner set it; the
-- flag records intent so a master price publish can leave it untouched.

create table billing.outlet_item_overrides (
  id               uuid primary key default gen_random_uuid(),
  outlet_id        uuid not null references billing.outlets(id) on delete cascade,
  catalog_item_id  uuid not null references billing.catalog_items(id) on delete cascade,
  name             text,
  description      text,
  image_url        text,
  category_id      uuid references billing.categories(id) on delete set null,
  price            numeric(12,2) check (price is null or price >= 0),
  gst_rate         numeric(5,2) check (gst_rate is null or (gst_rate >= 0 and gst_rate < 100)),
  is_available     boolean,
  availability_note text,
  updated_by       uuid references identity.account_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint outlet_item_overrides_uniq unique (outlet_id, catalog_item_id)
);
create trigger outlet_item_overrides_set_updated_at before update on billing.outlet_item_overrides
  for each row execute function identity.set_updated_at();

create table billing.outlet_addon_overrides (
  id            uuid primary key default gen_random_uuid(),
  outlet_id     uuid not null references billing.outlets(id) on delete cascade,
  addon_id      uuid not null references billing.addons(id) on delete cascade,
  name          text,
  price         numeric(12,2) check (price is null or price >= 0),
  is_available  boolean,
  updated_by    uuid references identity.account_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint outlet_addon_overrides_uniq unique (outlet_id, addon_id)
);
create trigger outlet_addon_overrides_set_updated_at before update on billing.outlet_addon_overrides
  for each row execute function identity.set_updated_at();

-- ---- Append-only price / tax history --------------------------------

-- Append-only. Ids are stored bare (no FK, like audit.events) so the
-- immutability triggers below are never fought by a cascade; the referenced
-- item/add-on/outlet may be archived later without disturbing this record.
create table billing.catalog_price_history (
  id              uuid primary key default gen_random_uuid(),
  scope           text not null check (scope in ('master_item','master_addon','outlet_item')),
  catalog_item_id uuid,
  addon_id        uuid,
  outlet_id       uuid,
  old_price       numeric(12,2),
  new_price       numeric(12,2),
  old_gst_rate    numeric(5,2),
  new_gst_rate    numeric(5,2),
  changed_by      uuid,
  changed_at      timestamptz not null default now()
);
create index catalog_price_history_item_idx on billing.catalog_price_history(catalog_item_id, changed_at desc);
create trigger catalog_price_history_no_update before update on billing.catalog_price_history
  for each row execute function identity.reject_mutation();
create trigger catalog_price_history_no_delete before delete on billing.catalog_price_history
  for each row execute function identity.reject_mutation();
