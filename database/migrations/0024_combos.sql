-- Combos (`docs/architecture/menu-publishing.md` "Central and Franchise
-- Owners may create combos within their scope. A combo references existing
-- component items and their recipes instead of owning a duplicate recipe" and
-- "Billing proportionally allocates combo value and discounts across
-- component sale lines for tax, reporting, and refunds").
--
-- A combo has its own GST-inclusive selling price but no gst_rate/hsn_code/
-- recipe of its own - those live on its components. At sale time the combo's
-- price is proportionally allocated across its components (by their own
-- standalone prices) so each becomes a normal bill_lines row with correct
-- per-component GST, refund, and Stock-recipe behavior.

create table billing.combos (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references billing.organizations(id) on delete restrict,
  brand_id             uuid not null references billing.brands(id) on delete restrict,
  owner_scope          billing.catalog_owner_scope not null,
  outlet_id            uuid references billing.outlets(id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 1 and 160),
  description          text check (description is null or length(description) <= 2000),
  image_url            text,
  price                numeric(12,2) not null check (price >= 0),   -- GST-inclusive
  is_available         boolean not null default true,
  availability_note    text,
  offline_sale_allowed boolean not null default true,
  status               billing.catalog_status not null default 'active',
  created_by           uuid references identity.account_profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint combos_scope_shape check (
    (owner_scope = 'master' and outlet_id is null) or
    (owner_scope = 'outlet' and outlet_id is not null)
  )
);
create index combos_brand_idx on billing.combos(brand_id) where owner_scope = 'master';
create index combos_outlet_idx on billing.combos(outlet_id) where owner_scope = 'outlet';
create trigger combos_set_updated_at before update on billing.combos
  for each row execute function identity.set_updated_at();

create table billing.combo_components (
  id             uuid primary key default gen_random_uuid(),
  combo_id       uuid not null references billing.combos(id) on delete cascade,
  catalog_item_id uuid not null references billing.catalog_items(id) on delete restrict,
  quantity       integer not null check (quantity > 0),
  display_order  integer not null default 0,
  constraint combo_components_uniq unique (combo_id, catalog_item_id)
);
create index combo_components_combo_idx on billing.combo_components(combo_id);

-- The flattened, immutable POS snapshot - one row per sellable combo in a
-- published version, paralleling outlet_menu_version_items. `components` is a
-- frozen snapshot (catalogItemId, name, unitPrice, gstRate, quantity,
-- stockRecipeId, stockRecipeVersion) of each component as it stood at publish
-- time, so a later catalog price change never rewrites an already-published
-- combo (same immutability guarantee as regular items).
create table billing.outlet_menu_version_combos (
  id                     uuid primary key default gen_random_uuid(),
  outlet_menu_version_id uuid not null references billing.outlet_menu_versions(id) on delete cascade,
  combo_id               uuid not null,
  category_name          text not null default 'Combos',
  category_order         integer not null default 0,
  combo_name             text not null,
  description            text,
  image_url              text,
  price                  numeric(12,2) not null check (price >= 0),
  is_available           boolean not null default true,
  availability_note      text,
  offline_sale_allowed   boolean not null default true,
  components             jsonb not null,
  constraint version_combos_uniq unique (outlet_menu_version_id, combo_id)
);
create index version_combos_version_idx on billing.outlet_menu_version_combos(outlet_menu_version_id);

create trigger version_combos_no_update before update on billing.outlet_menu_version_combos
  for each row execute function billing.reject_version_item_mutation();
create trigger version_combos_no_delete before delete on billing.outlet_menu_version_combos
  for each row execute function billing.reject_version_item_mutation();

-- A combo-derived bill line snapshots which combo it came from and groups its
-- exploded component lines together for receipt/history display. Refunds
-- still operate at the normal per-bill-line granularity (each component is
-- its own bill_lines row with the correct proportionally-allocated amount);
-- there is no separate "refund one combo unit" action in this pass.
alter table billing.bill_lines add column combo_id uuid;
alter table billing.bill_lines add column combo_name text;
alter table billing.bill_lines add column combo_group_id uuid;

-- ---- Grants and RLS -------------------------------------------------------

grant select, insert, update, delete on
  billing.combos,
  billing.combo_components,
  billing.outlet_menu_version_combos
  to identity_api;

alter table billing.combos                    enable row level security;
alter table billing.combo_components          enable row level security;
alter table billing.outlet_menu_version_combos enable row level security;

-- Same idiom as catalog_items: master combos readable by everyone in the
-- org (a Franchise Owner needs to see them to compose... no, combos don't
-- nest, but Central's master combos still need to be visible for override/
-- publish preview); outlet combos readable by Central or the owning outlet.
create policy combos_read on billing.combos for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or (owner_scope = 'master')
  or (outlet_id in (select outlets.id from billing.outlets))
);
create policy combos_write on billing.combos for all to identity_api using (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select outlets.id from billing.outlets))
) with check (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and outlet_id in (select outlets.id from billing.outlets))
);

create policy combo_components_read on billing.combo_components for select to identity_api using (
  exists (select 1 from billing.combos c where c.id = combo_id)
);
create policy combo_components_write on billing.combo_components for all to identity_api using (
  identity.is_system() or identity.is_central()
  or exists (
    select 1 from billing.combos c
     where c.id = combo_id and c.owner_scope = 'outlet'
       and c.outlet_id in (select outlets.id from billing.outlets)
  )
) with check (
  identity.is_system() or identity.is_central()
  or exists (
    select 1 from billing.combos c
     where c.id = combo_id and c.owner_scope = 'outlet'
       and c.outlet_id in (select outlets.id from billing.outlets)
  )
);

create policy version_combos_read on billing.outlet_menu_version_combos for select to identity_api using (
  outlet_menu_version_id in (select id from billing.outlet_menu_versions)
);
create policy version_combos_write on billing.outlet_menu_version_combos for all to identity_api using (
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
