-- Stock V1 S2 - Inventory Core: units and conversions, items and barcodes,
-- warehouses and locations, batches, the immutable movement ledger, transactional
-- balance projections, and weighted-average valuation.
-- docs/plans/stock-v1-build-plan.md "S2 - Inventory Core";
-- docs/architecture/billing-stock-recipe-contract.md "Optimization" (integer
-- base units), Core Invariants 1-4 and 10.

-- ---- Units and conversions --------------------------------------------

create type stock.dimension as enum ('mass', 'volume', 'count');

-- Base unit per dimension: mass -> g, volume -> ml, count -> each. Every stored
-- quantity is in the item's base unit as numeric(20,6) to avoid float drift.
create table stock.units (
  code           text primary key check (length(btrim(code)) between 1 and 20),
  name           text not null,
  dimension      stock.dimension not null,
  to_base_factor numeric(20,8) not null check (to_base_factor > 0),
  is_base        boolean not null default false
);

insert into stock.units (code, name, dimension, to_base_factor, is_base) values
  ('g',     'gram',        'mass',   1,       true),
  ('kg',    'kilogram',    'mass',   1000,    false),
  ('mg',    'milligram',   'mass',   0.001,   false),
  ('ml',    'millilitre',  'volume', 1,       true),
  ('l',     'litre',       'volume', 1000,    false),
  ('each',  'each',        'count',  1,       true),
  ('dozen', 'dozen',       'count',  12,      false)
on conflict (code) do nothing;

-- ---- Items -----------------------------------------------------------

create type stock.item_type as enum (
  'raw_material', 'packaged_product', 'packaging', 'consumable',
  'finished_good', 'intermediate'
);
create type stock.supply_rule as enum ('jksh_required', 'local_purchase', 'flexible');

create table stock.items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  brand_id         uuid,                         -- null: organization-shared generic
  sku              citext not null,
  name             text not null check (length(btrim(name)) between 1 and 160),
  item_type        stock.item_type not null,
  dimension        stock.dimension not null,
  base_unit        text not null references stock.units(code),
  supply_rule      stock.supply_rule not null default 'flexible',
  is_batch_tracked boolean not null default false,
  is_returnable    boolean not null default false,  -- sealed, resalable after approval
  shelf_life_days  integer check (shelf_life_days is null or shelf_life_days > 0),
  order_pack       numeric(20,6) check (order_pack is null or order_pack > 0),
  gst_rate         numeric(5,2) not null default 0 check (gst_rate >= 0 and gst_rate < 100),
  hsn_code         text,
  purchase_unit    text references stock.units(code),  -- default supplier / order pack unit
  is_active        boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint items_sku_uniq unique (organization_id, sku),
  constraint items_unit_dimension check (base_unit is not null)
);
create index items_org_idx on stock.items(organization_id) where is_active;
create index items_brand_idx on stock.items(brand_id) where brand_id is not null;
create trigger items_set_updated_at before update on stock.items
  for each row execute function stock.set_updated_at();

-- Item-specific unit conversions (versioned): e.g. 1 "spoon" of tea powder =
-- 2.4 g, which a generic gram factor cannot express.
create table stock.item_unit_conversions (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references stock.items(id) on delete cascade,
  from_unit   text not null check (length(btrim(from_unit)) between 1 and 20),
  to_base_qty numeric(20,8) not null check (to_base_qty > 0),
  version     integer not null default 1,
  is_current  boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint item_unit_conversions_ver_uniq unique (item_id, from_unit, version)
);
create unique index item_unit_conversions_current_uniq
  on stock.item_unit_conversions(item_id, from_unit) where is_current;

create table stock.item_barcodes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  item_id         uuid not null references stock.items(id) on delete cascade,
  barcode         citext not null,
  kind            text not null default 'alias' check (kind in ('ean','upc','qr','alias')),
  is_primary      boolean not null default false,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint item_barcodes_uniq unique (organization_id, barcode)
);
create index item_barcodes_item_idx on stock.item_barcodes(item_id);

-- ---- Warehouses and locations --------------------------------------

create table stock.warehouses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  code            text not null check (length(btrim(code)) between 1 and 40),
  name            text not null,
  timezone        text not null default 'Asia/Kolkata',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint warehouses_code_uniq unique (organization_id, code)
);
create trigger warehouses_set_updated_at before update on stock.warehouses
  for each row execute function stock.set_updated_at();

alter table stock.warehouse_assignments
  add constraint warehouse_assignments_warehouse_fk
  foreign key (warehouse_id) references stock.warehouses(id) on delete cascade;

create type stock.location_scope as enum ('warehouse', 'outlet');
create type stock.location_kind as enum (
  'sellable', 'quarantine', 'damaged', 'returns', 'in_transit',
  'production_input', 'production_output', 'staging'
);

-- One unified location table. Warehouses own several kinds; a franchise outlet
-- owns exactly one 'sellable' location. Every ledger and balance row points at
-- one stock_location.
create table stock.stock_locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  scope           stock.location_scope not null,
  warehouse_id    uuid references stock.warehouses(id) on delete cascade,
  outlet_id       uuid,
  franchise_id    uuid,
  kind            stock.location_kind not null,
  name            text not null,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint stock_locations_scope_shape check (
    (scope = 'warehouse' and warehouse_id is not null and outlet_id is null) or
    (scope = 'outlet'    and outlet_id is not null and warehouse_id is null)
  )
);
create unique index stock_locations_wh_kind_uniq
  on stock.stock_locations(warehouse_id, kind) where scope = 'warehouse';
create unique index stock_locations_outlet_kind_uniq
  on stock.stock_locations(outlet_id, kind) where scope = 'outlet';
create index stock_locations_outlet_idx on stock.stock_locations(outlet_id) where scope = 'outlet';

-- Per-outlet Stock tracking flag (mandatory for franchise outlets; a JKSH-owned
-- retail outlet may keep it disabled).
create table stock.outlet_stock_settings (
  outlet_id        uuid primary key,
  organization_id  uuid not null,
  franchise_id     uuid,
  tracking_enabled boolean not null default true,
  timezone         text not null default 'Asia/Kolkata',
  opening_count_done boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger outlet_stock_settings_set_updated_at before update on stock.outlet_stock_settings
  for each row execute function stock.set_updated_at();

-- ---- Batches / lots ------------------------------------------------

create type stock.batch_status as enum ('active', 'quarantined', 'recalled', 'consumed', 'expired');
create type stock.batch_origin as enum ('received', 'produced', 'opening', 'transfer', 'local_inward');

create table stock.batches (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  item_id           uuid not null references stock.items(id) on delete restrict,
  batch_code        text not null check (length(btrim(batch_code)) between 1 and 80),
  manufacture_date  date,
  expiry_date       date,
  origin            stock.batch_origin not null,
  status            stock.batch_status not null default 'active',
  recall_id         uuid,
  parent_batch_id   uuid references stock.batches(id) on delete set null,
  supplier_id       uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint batches_code_uniq unique (item_id, batch_code)
);
create index batches_item_fefo_idx on stock.batches(item_id, expiry_date nulls last)
  where status = 'active';
create trigger batches_set_updated_at before update on stock.batches
  for each row execute function stock.set_updated_at();

-- ---- Immutable movement ledger -----------------------------------
-- Every quantity change is one append-only row linked to a source document and
-- an idempotency key. Balances are a projection of this ledger.

create type stock.movement_type as enum (
  'opening', 'receipt', 'issue', 'adjustment', 'count_adjustment',
  'transfer_out', 'transfer_in', 'production_input', 'production_output',
  'wastage', 'consumption', 'return_in', 'recall_quarantine',
  'allocation_hold', 'allocation_release'
);

create table stock.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  stock_location_id uuid not null references stock.stock_locations(id) on delete restrict,
  warehouse_id      uuid,           -- denormalized from the location for cheap RLS
  outlet_id         uuid,
  franchise_id      uuid,
  item_id           uuid not null references stock.items(id) on delete restrict,
  batch_id          uuid references stock.batches(id) on delete restrict,
  quantity          numeric(20,6) not null,   -- signed: + into location, - out
  movement_type     stock.movement_type not null,
  unit_cost_paise   bigint check (unit_cost_paise is null or unit_cost_paise >= 0),
  source_doc_type   text not null,
  source_doc_id     uuid,
  idempotency_key   text not null,
  correlation_id    uuid,
  actor_request     text,
  actor_account_id  uuid,
  actor_employee_id uuid,
  notes             text,
  occurred_at       timestamptz not null default now(),
  constraint stock_movements_idem_uniq unique (organization_id, idempotency_key),
  constraint stock_movements_qty_nonzero check (quantity <> 0)
);
create index stock_movements_loc_item_idx
  on stock.stock_movements(stock_location_id, item_id, occurred_at);
create index stock_movements_source_idx
  on stock.stock_movements(source_doc_type, source_doc_id);
create index stock_movements_item_time_idx
  on stock.stock_movements(organization_id, item_id, occurred_at);
create trigger stock_movements_no_update before update on stock.stock_movements
  for each row execute function stock.reject_mutation();
create trigger stock_movements_no_delete before delete on stock.stock_movements
  for each row execute function stock.reject_mutation();

-- ---- Balance projection ------------------------------------------

create table stock.stock_balances (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  stock_location_id uuid not null references stock.stock_locations(id) on delete cascade,
  warehouse_id      uuid,
  outlet_id         uuid,
  franchise_id      uuid,
  item_id           uuid not null references stock.items(id) on delete cascade,
  batch_id          uuid references stock.batches(id) on delete cascade,
  on_hand           numeric(20,6) not null default 0,
  allocated         numeric(20,6) not null default 0 check (allocated >= 0),
  updated_at        timestamptz not null default now()
);
create unique index stock_balances_key_uniq on stock.stock_balances(
  stock_location_id, item_id, coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index stock_balances_item_idx on stock.stock_balances(organization_id, item_id)
  where on_hand <> 0 or allocated <> 0;
create index stock_balances_outlet_idx on stock.stock_balances(outlet_id) where outlet_id is not null;

-- ---- Weighted-average valuation --------------------------------
-- Accounting valuation uses moving weighted-average cost per (org, item).
-- Rebuildable by replaying inbound movements in occurred_at order.

create table stock.item_valuation (
  organization_id  uuid not null,
  item_id          uuid not null references stock.items(id) on delete cascade,
  avg_cost_paise   numeric(24,6) not null default 0,
  on_hand_qty      numeric(20,6) not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, item_id)
);

-- ---- Grants + RLS ---------------------------------------------

grant select on stock.units, stock.item_unit_conversions to stock_api;
grant select, insert, update on stock.items to stock_api;
grant select, insert, update, delete on stock.item_unit_conversions to stock_api;
grant select, insert, update, delete on stock.item_barcodes to stock_api;
grant select, insert, update on stock.warehouses, stock.stock_locations to stock_api;
grant select, insert, update on stock.outlet_stock_settings to stock_api;
grant select, insert, update on stock.batches to stock_api;
grant select, insert on stock.stock_movements to stock_api;
-- delete on the projection tables is for reconciliation rebuilds only; the
-- ledger itself is append-only.
grant select, insert, update, delete on stock.stock_balances to stock_api;
grant select, insert, update, delete on stock.item_valuation to stock_api;

alter table stock.units                 enable row level security;
alter table stock.item_unit_conversions enable row level security;
alter table stock.items                 enable row level security;
alter table stock.item_barcodes         enable row level security;
alter table stock.warehouses            enable row level security;
alter table stock.stock_locations       enable row level security;
alter table stock.outlet_stock_settings enable row level security;
alter table stock.batches               enable row level security;
alter table stock.stock_movements       enable row level security;
alter table stock.stock_balances        enable row level security;
alter table stock.item_valuation        enable row level security;

-- Reference / master data: readable by any Stock actor, written by Central.
create policy units_read on stock.units for select to stock_api using (true);
create policy iuc_read on stock.item_unit_conversions for select to stock_api using (true);
create policy iuc_write on stock.item_unit_conversions for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());
create policy items_read on stock.items for select to stock_api using (true);
create policy items_write on stock.items for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());
create policy item_barcodes_read on stock.item_barcodes for select to stock_api using (true);
create policy item_barcodes_write on stock.item_barcodes for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_warehouse_manager())
  with check (stock.is_system() or stock.is_central() or stock.is_warehouse_manager());
create policy warehouses_read on stock.warehouses for select to stock_api using (true);
create policy warehouses_write on stock.warehouses for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());
create policy stock_locations_read on stock.stock_locations for select to stock_api using (true);
create policy stock_locations_write on stock.stock_locations for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());

create policy outlet_stock_settings_read on stock.outlet_stock_settings for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_owner_of(franchise_id)
    or outlet_id = stock.ctx_uuid('outlet_id')
  );
create policy outlet_stock_settings_write on stock.outlet_stock_settings for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_owner_of(franchise_id))
  with check (stock.is_system() or stock.is_central() or stock.is_owner_of(franchise_id));

create policy batches_read on stock.batches for select to stock_api using (true);
create policy batches_write on stock.batches for all to stock_api
  using (
    stock.is_system() or stock.is_central()
    or stock.is_warehouse_manager() or stock.is_warehouse_staff()
    or stock.ctx('role') = 'franchise_owner' or stock.ctx('request') = 'operator'
  )
  with check (
    stock.is_system() or stock.is_central()
    or stock.is_warehouse_manager() or stock.is_warehouse_staff()
    or stock.ctx('role') = 'franchise_owner' or stock.ctx('request') = 'operator'
  );

-- Ledger / balances / valuation: scoped reads, writes only by system/central
-- (domain functions post under systemContext) plus warehouse operators for
-- their assigned warehouse and outlet actors for their own outlet.
create policy stock_movements_read on stock.stock_movements for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_owner_of(franchise_id)
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or (outlet_id is not null and outlet_id = stock.ctx_uuid('outlet_id'))
  );
create policy stock_movements_insert on stock.stock_movements for insert to stock_api
  with check (
    stock.is_system() or stock.is_central()
    or (warehouse_id is not null and stock.can_operate_warehouse(warehouse_id))
    or (outlet_id is not null and (stock.is_owner_of(franchise_id) or outlet_id = stock.ctx_uuid('outlet_id')))
  );

create policy stock_balances_read on stock.stock_balances for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_owner_of(franchise_id)
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or (outlet_id is not null and outlet_id = stock.ctx_uuid('outlet_id'))
  );
create policy stock_balances_write on stock.stock_balances for all to stock_api
  using (
    stock.is_system() or stock.is_central()
    or (warehouse_id is not null and stock.can_operate_warehouse(warehouse_id))
    or (outlet_id is not null and (stock.is_owner_of(franchise_id) or outlet_id = stock.ctx_uuid('outlet_id')))
  )
  with check (
    stock.is_system() or stock.is_central()
    or (warehouse_id is not null and stock.can_operate_warehouse(warehouse_id))
    or (outlet_id is not null and (stock.is_owner_of(franchise_id) or outlet_id = stock.ctx_uuid('outlet_id')))
  );

create policy item_valuation_read on stock.item_valuation for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant());
create policy item_valuation_write on stock.item_valuation for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());
