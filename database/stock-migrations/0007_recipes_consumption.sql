-- Stock V1 S5 - Recipes and Billing-event integration: immutable versioned
-- recipes with SOP scaling inputs, optional prepared bases, the SaleCompleted /
-- SaleRefunded consumers, negative-stock exceptions, and local inward.
-- docs/architecture/billing-stock-recipe-contract.md;
-- docs/architecture/t-vanamm-recipe-standardization.md; Core Invariants 3, 7, 8.

-- ---- Recipes -------------------------------------------------

create type stock.recipe_kind as enum ('menu_item', 'addon', 'intermediate');
create type stock.recipe_status as enum (
  'draft', 'draft_needs_standardization', 'published', 'archived'
);
create type stock.recipe_component_type as enum (
  'fixed', 'optional', 'alternative', 'addon', 'packaging'
);

create table stock.recipes (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  brand_id              uuid,
  kind                  stock.recipe_kind not null,
  billing_menu_item_id  uuid,          -- Billing catalog_items.id (bare, no FK)
  billing_addon_id      uuid,
  output_item_id        uuid references stock.items(id) on delete set null,
  name                  text not null,
  status                stock.recipe_status not null default 'draft',
  current_version       integer not null default 0,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index recipes_menu_item_idx on stock.recipes(billing_menu_item_id)
  where billing_menu_item_id is not null;
create trigger recipes_set_updated_at before update on stock.recipes
  for each row execute function stock.set_updated_at();

create table stock.recipe_versions (
  id                    uuid primary key default gen_random_uuid(),
  recipe_id             uuid not null references stock.recipes(id) on delete cascade,
  version               integer not null,
  batch_yield_base      numeric(20,6),           -- measured usable finished yield
  serving_qty_base      numeric(20,6) not null check (serving_qty_base > 0),
  serving_unit          text not null,
  prepared_base_item_id uuid references stock.items(id) on delete set null,
  prepared_base_qty_base numeric(20,6) check (prepared_base_qty_base is null or prepared_base_qty_base > 0),
  yield_unverified      boolean not null default false,
  checksum              text not null,
  published_at          timestamptz not null default now(),
  published_by          uuid,
  constraint recipe_versions_uniq unique (recipe_id, version)
);
create trigger recipe_versions_no_update before update on stock.recipe_versions
  for each row execute function stock.reject_mutation();
create trigger recipe_versions_no_delete before delete on stock.recipe_versions
  for each row execute function stock.reject_mutation();

create table stock.recipe_components (
  id                 uuid primary key default gen_random_uuid(),
  recipe_version_id  uuid not null references stock.recipe_versions(id) on delete cascade,
  component_type     stock.recipe_component_type not null,
  item_id            uuid not null references stock.items(id) on delete restrict,
  qty_base           numeric(20,6) not null check (qty_base > 0),
  alternative_group  text,
  is_default         boolean not null default true,
  process_loss_pct   numeric(6,3) not null default 0 check (process_loss_pct >= 0 and process_loss_pct < 100)
);
create index recipe_components_version_idx on stock.recipe_components(recipe_version_id);
create trigger recipe_components_no_update before update on stock.recipe_components
  for each row execute function stock.reject_mutation();
create trigger recipe_components_no_delete before delete on stock.recipe_components
  for each row execute function stock.reject_mutation();

-- ---- Prepared bases -------------------------------------

create table stock.prepared_batches (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  stock_location_id uuid not null references stock.stock_locations(id) on delete restrict,
  outlet_id         uuid,
  item_id           uuid not null references stock.items(id) on delete restrict,
  batch_id          uuid references stock.batches(id) on delete set null,
  qty_base_initial  numeric(20,6) not null check (qty_base_initial > 0),
  qty_base_remaining numeric(20,6) not null check (qty_base_remaining >= 0),
  recorded_by       uuid,
  recorded_at       timestamptz not null default now()
);
create index prepared_batches_lookup_idx
  on stock.prepared_batches(stock_location_id, item_id)
  where qty_base_remaining > 0;

-- ---- Sale consumption ---------------------------------

create type stock.consumption_status as enum ('processed', 'negative_exception', 'failed', 'refund_noop');

create table stock.sale_consumptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  source_event_id  uuid not null,
  event_type       text not null,
  bill_id          uuid,
  outlet_id        uuid,
  business_date    date,
  status           stock.consumption_status not null,
  processed_at     timestamptz not null default now(),
  constraint sale_consumptions_event_uniq unique (source_event_id)
);
create index sale_consumptions_outlet_idx on stock.sale_consumptions(outlet_id, business_date);

create table stock.sale_consumption_lines (
  id                  uuid primary key default gen_random_uuid(),
  sale_consumption_id uuid not null references stock.sale_consumptions(id) on delete cascade,
  bill_line_id        uuid,
  catalog_item_id     uuid,
  recipe_id           uuid,
  recipe_version      integer,
  item_id             uuid not null references stock.items(id) on delete restrict,
  batch_id            uuid,
  qty_base            numeric(20,6) not null,
  from_prepared       boolean not null default false,
  negative_shortfall_base numeric(20,6) not null default 0
);
create index sale_consumption_lines_parent_idx on stock.sale_consumption_lines(sale_consumption_id);

create table stock.negative_stock_exceptions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  outlet_id           uuid,
  stock_location_id   uuid,
  item_id             uuid not null references stock.items(id) on delete restrict,
  sale_consumption_id uuid references stock.sale_consumptions(id) on delete set null,
  qty_base            numeric(20,6) not null check (qty_base > 0),
  business_date       date,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index negative_stock_exceptions_open_idx on stock.negative_stock_exceptions(outlet_id)
  where resolved_at is null;

-- ---- Local inward -----------------------------------

create type stock.local_inward_status as enum ('pending_review', 'confirmed', 'reversed');
create type stock.valuation_state as enum ('cost_pending', 'costed');

create table stock.local_inwards (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  outlet_id        uuid not null,
  franchise_id     uuid not null,
  stock_location_id uuid not null references stock.stock_locations(id) on delete restrict,
  item_id          uuid not null references stock.items(id) on delete restrict,
  batch_id         uuid references stock.batches(id) on delete set null,
  qty_base         numeric(20,6) not null check (qty_base > 0),
  unit_cost_paise  bigint check (unit_cost_paise is null or unit_cost_paise >= 0),
  supplier_name    text,
  invoice_number   text,
  valuation_state  stock.valuation_state not null default 'cost_pending',
  status           stock.local_inward_status not null default 'pending_review',
  movement_id      uuid,
  recorded_by      uuid,
  reviewed_by      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index local_inwards_review_idx on stock.local_inwards(outlet_id) where status = 'pending_review';
create trigger local_inwards_set_updated_at before update on stock.local_inwards
  for each row execute function stock.set_updated_at();

-- ---- Grants + RLS ---------------------------------

grant select, insert, update on
  stock.recipes, stock.recipe_versions, stock.recipe_components,
  stock.prepared_batches, stock.sale_consumptions, stock.sale_consumption_lines,
  stock.negative_stock_exceptions, stock.local_inwards
  to stock_api;

alter table stock.recipes                    enable row level security;
alter table stock.recipe_versions            enable row level security;
alter table stock.recipe_components          enable row level security;
alter table stock.prepared_batches           enable row level security;
alter table stock.sale_consumptions          enable row level security;
alter table stock.sale_consumption_lines     enable row level security;
alter table stock.negative_stock_exceptions  enable row level security;
alter table stock.local_inwards              enable row level security;

-- Recipes: any Stock actor may read; only Central writes / publishes.
create policy recipes_read on stock.recipes for select to stock_api using (true);
create policy recipes_write on stock.recipes for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());
create policy recipe_versions_read on stock.recipe_versions for select to stock_api using (true);
create policy recipe_versions_write on stock.recipe_versions for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());
create policy recipe_components_read on stock.recipe_components for select to stock_api using (true);
create policy recipe_components_write on stock.recipe_components for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());

create policy prepared_batches_read on stock.prepared_batches for select to stock_api
  using (
    stock.is_system() or stock.is_central()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or stock_location_id in (select id from stock.stock_locations
                              where warehouse_id is not null and stock.has_warehouse(warehouse_id))
  );
create policy prepared_batches_write on stock.prepared_batches for all to stock_api
  using (
    stock.is_system() or stock.is_central()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or stock.ctx('role') = 'franchise_owner'
  )
  with check (
    stock.is_system() or stock.is_central()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or stock.ctx('role') = 'franchise_owner'
  );

create policy sale_consumptions_read on stock.sale_consumptions for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = sale_consumptions.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );
create policy sale_consumptions_write on stock.sale_consumptions for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());
create policy sale_consumption_lines_rw on stock.sale_consumption_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or sale_consumption_id in (select id from stock.sale_consumptions))
  with check (stock.is_system() or stock.is_central()
              or sale_consumption_id in (select id from stock.sale_consumptions));

create policy neg_exceptions_read on stock.negative_stock_exceptions for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = negative_stock_exceptions.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );
create policy neg_exceptions_write on stock.negative_stock_exceptions for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());

create policy local_inwards_read on stock.local_inwards for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_owner_of(franchise_id)
    or outlet_id = stock.ctx_uuid('outlet_id')
  );
create policy local_inwards_write on stock.local_inwards for all to stock_api
  using (
    stock.is_system() or stock.is_central()
    or stock.is_owner_of(franchise_id) or outlet_id = stock.ctx_uuid('outlet_id')
  )
  with check (
    stock.is_system() or stock.is_central()
    or stock.is_owner_of(franchise_id) or outlet_id = stock.ctx_uuid('outlet_id')
  );
