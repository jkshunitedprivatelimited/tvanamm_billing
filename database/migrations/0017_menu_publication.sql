-- Billing V1 Stage 1 - Immutable menu publication.
-- docs/plans/billing-data-api-plan.md §5 ; docs/architecture/menu-publishing.md
--
-- Saving authoring changes never touches a live menu. `Publish to outlets`
-- records a publication + one target per outlet, then applies a complete
-- immutable `outlet_menu_versions` snapshot per outlet atomically. Retrying a
-- publication re-runs only its failed targets and never produces two versions
-- for one successful target.

create type billing.publication_status as enum
  ('previewed', 'applying', 'completed', 'partly_failed', 'failed');
create type billing.publication_target_status as enum
  ('pending', 'applying', 'succeeded', 'skipped', 'failed');

create table billing.menu_publications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references billing.organizations(id) on delete restrict,
  brand_id          uuid not null references billing.brands(id) on delete restrict,
  initiator_scope   billing.catalog_owner_scope not null,        -- 'master' = Central, 'outlet' = FO
  actor_account_id  uuid references identity.account_profiles(id) on delete set null,
  origin_outlet_id  uuid references billing.outlets(id) on delete cascade,  -- set for FO publications
  overwrite_price   boolean not null default false,
  forced_fields     text[] not null default '{}',
  status            billing.publication_status not null default 'previewed',
  correlation_id    uuid not null,
  notes             text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint menu_publications_origin_shape check (
    (initiator_scope = 'master' and origin_outlet_id is null) or
    (initiator_scope = 'outlet' and origin_outlet_id is not null)
  )
);
create index menu_publications_brand_idx on billing.menu_publications(brand_id, created_at desc);

create table billing.menu_publication_targets (
  id                     uuid primary key default gen_random_uuid(),
  publication_id         uuid not null references billing.menu_publications(id) on delete cascade,
  outlet_id              uuid not null references billing.outlets(id) on delete cascade,
  status                 billing.publication_target_status not null default 'pending',
  outlet_menu_version_id uuid,
  attempts               integer not null default 0,
  error                  text,
  updated_at             timestamptz not null default now(),
  constraint publication_targets_uniq unique (publication_id, outlet_id)
);
create index publication_targets_pub_idx on billing.menu_publication_targets(publication_id);
create trigger publication_targets_set_updated_at before update on billing.menu_publication_targets
  for each row execute function identity.set_updated_at();

create table billing.outlet_menu_versions (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references billing.outlets(id) on delete cascade,
  version        bigint not null,
  publication_id uuid references billing.menu_publications(id) on delete set null,
  item_count     integer not null default 0,
  checksum       text not null,
  is_current     boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint outlet_menu_versions_uniq unique (outlet_id, version)
);
create unique index outlet_menu_versions_current
  on billing.outlet_menu_versions(outlet_id) where is_current;

-- The flattened, immutable POS snapshot. One row per sellable item in a version.
create table billing.outlet_menu_version_items (
  id                     uuid primary key default gen_random_uuid(),
  outlet_menu_version_id uuid not null references billing.outlet_menu_versions(id) on delete cascade,
  catalog_item_id        uuid not null,
  category_name          text not null default 'Menu',
  category_order         integer not null default 0,
  item_name              text not null,
  description            text,
  image_url              text,
  gst_rate               numeric(5,2) not null default 0,
  price                  numeric(12,2) not null check (price >= 0),   -- GST-inclusive
  is_available           boolean not null default true,
  availability_note      text,
  addons                 jsonb not null default '[]'::jsonb,
  stock_recipe_id        uuid,
  stock_recipe_version   integer,
  offline_sale_allowed   boolean not null default true,
  constraint version_items_uniq unique (outlet_menu_version_id, catalog_item_id)
);
create index version_items_version_idx on billing.outlet_menu_version_items(outlet_menu_version_id);

-- A published version and its items are immutable once written (is_current flips
-- as new versions supersede, so the flag column is exempt).
create or replace function billing.reject_version_item_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception 'billing.outlet_menu_version_items rows are immutable' using errcode = '0A000';
end;
$$;
create trigger version_items_no_update before update on billing.outlet_menu_version_items
  for each row execute function billing.reject_version_item_mutation();
create trigger version_items_no_delete before delete on billing.outlet_menu_version_items
  for each row execute function billing.reject_version_item_mutation();

-- ---- Grants --------------------------------------------------------------

grant select, insert, update, delete on
  billing.categories,
  billing.addon_groups,
  billing.addons,
  billing.catalog_items,
  billing.item_addon_groups,
  billing.outlet_item_overrides,
  billing.outlet_addon_overrides,
  billing.menu_publications,
  billing.menu_publication_targets,
  billing.outlet_menu_versions,
  billing.outlet_menu_version_items
  to identity_api;
grant select, insert on billing.catalog_price_history to identity_api;

-- ---- RLS --------------------------------------------------------------

alter table billing.categories                enable row level security;
alter table billing.addon_groups              enable row level security;
alter table billing.addons                    enable row level security;
alter table billing.catalog_items             enable row level security;
alter table billing.item_addon_groups         enable row level security;
alter table billing.outlet_item_overrides     enable row level security;
alter table billing.outlet_addon_overrides    enable row level security;
alter table billing.catalog_price_history     enable row level security;
alter table billing.menu_publications         enable row level security;
alter table billing.menu_publication_targets  enable row level security;
alter table billing.outlet_menu_versions      enable row level security;
alter table billing.outlet_menu_version_items enable row level security;

-- Master rows: Central writes, everyone in the org may read (a franchise owner
-- needs the master menu to build overrides). Outlet-scoped rows: Central or the
-- owning franchise; the operator may read only its own outlet's rows.
create policy categories_read on billing.categories for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or owner_scope = 'master'
  or outlet_id in (select id from billing.outlets)
);
create policy categories_write on billing.categories for all to identity_api using (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select id from billing.outlets))
) with check (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select id from billing.outlets))
);

create policy addon_groups_read on billing.addon_groups for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or owner_scope = 'master' or outlet_id in (select id from billing.outlets)
);
create policy addon_groups_write on billing.addon_groups for all to identity_api using (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select id from billing.outlets))
) with check (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select id from billing.outlets))
);

create policy addons_read on billing.addons for select to identity_api using (
  addon_group_id in (select id from billing.addon_groups)
);
create policy addons_write on billing.addons for all to identity_api using (
  identity.is_system() or identity.is_central()
  or addon_group_id in (select id from billing.addon_groups where owner_scope = 'outlet')
) with check (
  identity.is_system() or identity.is_central()
  or addon_group_id in (select id from billing.addon_groups where owner_scope = 'outlet')
);

create policy catalog_items_read on billing.catalog_items for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or owner_scope = 'master' or outlet_id in (select id from billing.outlets)
);
create policy catalog_items_write on billing.catalog_items for all to identity_api using (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select id from billing.outlets))
) with check (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select id from billing.outlets))
);

create policy item_addon_groups_rw on billing.item_addon_groups for all to identity_api using (
  catalog_item_id in (select id from billing.catalog_items)
) with check (
  catalog_item_id in (select id from billing.catalog_items)
);

create policy outlet_item_overrides_rw on billing.outlet_item_overrides for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
) with check (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
);
create policy outlet_addon_overrides_rw on billing.outlet_addon_overrides for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
) with check (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
);

create policy price_history_read on billing.catalog_price_history for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or outlet_id in (select id from billing.outlets)
);
create policy price_history_insert on billing.catalog_price_history for insert to identity_api
  with check (identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets));

create policy publications_read on billing.menu_publications for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or origin_outlet_id in (select id from billing.outlets)
);
create policy publications_write on billing.menu_publications for all to identity_api using (
  identity.is_system() or identity.is_central()
  or (initiator_scope = 'outlet' and origin_outlet_id in (select id from billing.outlets))
) with check (
  identity.is_system() or identity.is_central()
  or (initiator_scope = 'outlet' and origin_outlet_id in (select id from billing.outlets))
);

create policy publication_targets_rw on billing.menu_publication_targets for all to identity_api using (
  publication_id in (select id from billing.menu_publications)
) with check (
  publication_id in (select id from billing.menu_publications)
);

create policy menu_versions_read on billing.outlet_menu_versions for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or outlet_id in (select id from billing.outlets)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy menu_versions_write on billing.outlet_menu_versions for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
) with check (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
);

create policy version_items_read on billing.outlet_menu_version_items for select to identity_api using (
  outlet_menu_version_id in (select id from billing.outlet_menu_versions)
);
create policy version_items_write on billing.outlet_menu_version_items for all to identity_api using (
  identity.is_system() or identity.is_central()
  or outlet_menu_version_id in (
    select v.id from billing.outlet_menu_versions v where v.outlet_id in (select id from billing.outlets)
  )
) with check (
  identity.is_system() or identity.is_central()
  or outlet_menu_version_id in (
    select v.id from billing.outlet_menu_versions v where v.outlet_id in (select id from billing.outlets)
  )
);

-- Catalog capabilities (catalog.menu.manage.master / .publish /
-- .manage.franchise / catalog.price.configure.outlet) and their role grants are
-- already seeded in migration 0007 and mirrored by @jksh/contracts
-- ROLE_CAPABILITIES; nothing to add here. Central holds `.publish`; a Franchise
-- Owner publishes its own outlet under `catalog.menu.manage.franchise`.
