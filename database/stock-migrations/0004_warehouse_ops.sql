-- Stock V1 S3 (part 2) - Warehouse operations: production with batch genealogy,
-- physical counts with a second-approver rule, wastage, JKSH-owned location
-- transfers, thermal label jobs, and document reversals.
-- docs/plans/stock-v1-build-plan.md "Production", "Counts and wastage",
-- "JKSH location transfers"; Core Invariants 5, 6.

-- ---- Production --------------------------------------------------

create type stock.production_status as enum (
  'draft', 'materials_issued', 'produced', 'quality_checked', 'posted', 'cancelled'
);

create table stock.production_orders (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  warehouse_id      uuid not null references stock.warehouses(id) on delete restrict,
  output_item_id    uuid not null references stock.items(id) on delete restrict,
  planned_qty_base  numeric(20,6) not null check (planned_qty_base > 0),
  produced_qty_base numeric(20,6) not null default 0,
  loss_qty_base     numeric(20,6) not null default 0,
  output_batch_id   uuid references stock.batches(id) on delete set null,
  recipe_id         uuid,
  recipe_version    integer,
  status            stock.production_status not null default 'draft',
  started_by        uuid,
  posted_by         uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index production_orders_wh_idx on stock.production_orders(warehouse_id, status);
create trigger production_orders_set_updated_at before update on stock.production_orders
  for each row execute function stock.set_updated_at();

create table stock.production_inputs (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id  uuid not null references stock.production_orders(id) on delete cascade,
  item_id             uuid not null references stock.items(id) on delete restrict,
  batch_id            uuid references stock.batches(id) on delete set null,
  qty_base            numeric(20,6) not null check (qty_base > 0)
);
create index production_inputs_order_idx on stock.production_inputs(production_order_id);

create table stock.production_outputs (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id  uuid not null references stock.production_orders(id) on delete cascade,
  batch_id            uuid not null references stock.batches(id) on delete restrict,
  qty_base            numeric(20,6) not null check (qty_base > 0),
  disposition         text not null check (disposition in ('accepted','rejected'))
);
create index production_outputs_order_idx on stock.production_outputs(production_order_id);

-- ---- Physical counts -----------------------------------------

create type stock.count_type as enum ('full', 'cycle');
create type stock.count_status as enum ('open', 'counting', 'review', 'closed', 'cancelled');

create table stock.stock_counts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  stock_location_id uuid not null references stock.stock_locations(id) on delete restrict,
  warehouse_id      uuid,
  outlet_id         uuid,
  franchise_id      uuid,
  count_type        stock.count_type not null,
  status            stock.count_status not null default 'open',
  period_label      text,
  opened_by         uuid,
  closed_by         uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index stock_counts_loc_idx on stock.stock_counts(stock_location_id, status);
create trigger stock_counts_set_updated_at before update on stock.stock_counts
  for each row execute function stock.set_updated_at();

create table stock.stock_count_lines (
  id               uuid primary key default gen_random_uuid(),
  stock_count_id   uuid not null references stock.stock_counts(id) on delete cascade,
  item_id          uuid not null references stock.items(id) on delete restrict,
  batch_id         uuid references stock.batches(id) on delete set null,
  system_qty_base  numeric(20,6) not null,
  counted_qty_base numeric(20,6) not null,
  variance_qty_base numeric(20,6) generated always as (counted_qty_base - system_qty_base) stored,
  reason           text,
  adjustment_movement_id uuid,
  constraint stock_count_lines_uniq unique (stock_count_id, item_id, batch_id)
);

-- Nobody approves their own exceptional adjustment.
create table stock.count_adjustment_approvals (
  stock_count_id uuid primary key references stock.stock_counts(id) on delete cascade,
  requested_by   uuid,
  approved_by    uuid,
  approved_at    timestamptz not null default now(),
  constraint count_adjustment_distinct_actor check (
    requested_by is null or approved_by is null or requested_by <> approved_by
  )
);

-- ---- Wastage ------------------------------------------------

create table stock.wastage_events (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  stock_location_id uuid not null references stock.stock_locations(id) on delete restrict,
  warehouse_id      uuid,
  outlet_id         uuid,
  franchise_id      uuid,
  item_id           uuid not null references stock.items(id) on delete restrict,
  batch_id          uuid references stock.batches(id) on delete set null,
  qty_base          numeric(20,6) not null check (qty_base > 0),
  reason            text not null check (reason in
    ('spoilage','breakage','expiry','preparation_loss','customer_cancelled','pest','other')),
  evidence_url      text,
  movement_id       uuid,
  recorded_by       uuid,
  occurred_at       timestamptz not null default now()
);
create index wastage_events_loc_idx on stock.wastage_events(stock_location_id, occurred_at desc);

-- ---- JKSH-owned location transfers -------------------------

create type stock.transfer_status as enum (
  'draft', 'dispatched', 'partially_received', 'received', 'closed', 'cancelled'
);

create table stock.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  from_location_id  uuid not null references stock.stock_locations(id) on delete restrict,
  to_location_id    uuid not null references stock.stock_locations(id) on delete restrict,
  transfer_number   text not null,
  status            stock.transfer_status not null default 'draft',
  dispatched_by     uuid,
  received_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint stock_transfers_number_uniq unique (organization_id, transfer_number),
  constraint stock_transfers_distinct check (from_location_id <> to_location_id)
);
create trigger stock_transfers_set_updated_at before update on stock.stock_transfers
  for each row execute function stock.set_updated_at();

-- Direct transfers only between JKSH-owned (warehouse-scoped) locations.
create or replace function stock.assert_transfer_jksh_owned()
returns trigger language plpgsql as $$
declare from_scope text; to_scope text;
begin
  select scope::text into from_scope from stock.stock_locations where id = new.from_location_id;
  select scope::text into to_scope from stock.stock_locations where id = new.to_location_id;
  if from_scope <> 'warehouse' or to_scope <> 'warehouse' then
    raise exception 'direct transfers are only allowed between JKSH-owned warehouse locations';
  end if;
  return new;
end;
$$;
create trigger stock_transfers_jksh_owned before insert on stock.stock_transfers
  for each row execute function stock.assert_transfer_jksh_owned();

create table stock.stock_transfer_lines (
  id                uuid primary key default gen_random_uuid(),
  stock_transfer_id uuid not null references stock.stock_transfers(id) on delete cascade,
  item_id           uuid not null references stock.items(id) on delete restrict,
  batch_id          uuid references stock.batches(id) on delete set null,
  qty_base          numeric(20,6) not null check (qty_base > 0),
  dispatched_qty_base numeric(20,6) not null default 0,
  received_qty_base numeric(20,6) not null default 0,
  damaged_qty_base  numeric(20,6) not null default 0,
  shortage_qty_base numeric(20,6) not null default 0
);
create index stock_transfer_lines_transfer_idx on stock.stock_transfer_lines(stock_transfer_id);

-- ---- Thermal label jobs -----------------------------------

create table stock.label_jobs (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  item_id      uuid not null references stock.items(id) on delete restrict,
  batch_id     uuid references stock.batches(id) on delete set null,
  quantity     integer not null check (quantity > 0),
  template     text not null,
  paper_mm     integer not null default 50 check (paper_mm in (38, 50, 58, 80)),
  payload      jsonb not null default '{}'::jsonb,
  printed_by   uuid,
  printed_at   timestamptz not null default now()
);
create index label_jobs_item_idx on stock.label_jobs(item_id, printed_at desc);

-- ---- Document reversals ----------------------------------

create table stock.document_reversals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  source_doc_type  text not null,
  source_doc_id    uuid not null,
  reason           text not null,
  reversed_by      uuid,
  created_at       timestamptz not null default now(),
  constraint document_reversals_uniq unique (source_doc_type, source_doc_id)
);

-- ---- Grants + RLS ---------------------------------------

grant select, insert, update on
  stock.production_orders, stock.production_inputs, stock.production_outputs,
  stock.stock_counts, stock.stock_count_lines, stock.count_adjustment_approvals,
  stock.wastage_events, stock.stock_transfers, stock.stock_transfer_lines,
  stock.label_jobs, stock.document_reversals
  to stock_api;

alter table stock.production_orders          enable row level security;
alter table stock.production_inputs          enable row level security;
alter table stock.production_outputs         enable row level security;
alter table stock.stock_counts               enable row level security;
alter table stock.stock_count_lines          enable row level security;
alter table stock.count_adjustment_approvals enable row level security;
alter table stock.wastage_events             enable row level security;
alter table stock.stock_transfers            enable row level security;
alter table stock.stock_transfer_lines       enable row level security;
alter table stock.label_jobs                 enable row level security;
alter table stock.document_reversals         enable row level security;

create policy production_orders_read on stock.production_orders for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id));
create policy production_orders_write on stock.production_orders for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id))
  with check (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id));

create policy production_inputs_rw on stock.production_inputs for all to stock_api
  using (stock.is_system() or stock.is_central()
         or production_order_id in (select id from stock.production_orders))
  with check (stock.is_system() or stock.is_central()
              or production_order_id in (select id from stock.production_orders));
create policy production_outputs_rw on stock.production_outputs for all to stock_api
  using (stock.is_system() or stock.is_central()
         or production_order_id in (select id from stock.production_orders))
  with check (stock.is_system() or stock.is_central()
              or production_order_id in (select id from stock.production_orders));

create policy stock_counts_read on stock.stock_counts for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_owner_of(franchise_id)
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or (outlet_id is not null and outlet_id = stock.ctx_uuid('outlet_id'))
  );
create policy stock_counts_write on stock.stock_counts for all to stock_api
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

create policy count_lines_rw on stock.stock_count_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or stock_count_id in (select id from stock.stock_counts))
  with check (stock.is_system() or stock.is_central()
              or stock_count_id in (select id from stock.stock_counts));
create policy count_approvals_rw on stock.count_adjustment_approvals for all to stock_api
  using (stock.is_system() or stock.is_central()
         or stock_count_id in (select id from stock.stock_counts))
  with check (stock.is_system() or stock.is_central()
              or stock_count_id in (select id from stock.stock_counts));

create policy wastage_read on stock.wastage_events for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_owner_of(franchise_id)
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or (outlet_id is not null and outlet_id = stock.ctx_uuid('outlet_id'))
  );
create policy wastage_write on stock.wastage_events for all to stock_api
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

create policy transfers_read on stock.stock_transfers for select to stock_api
  using (stock.is_system() or stock.is_central()
         or from_location_id in (select id from stock.stock_locations
                                  where warehouse_id is not null and stock.has_warehouse(warehouse_id))
         or to_location_id in (select id from stock.stock_locations
                                where warehouse_id is not null and stock.has_warehouse(warehouse_id)));
create policy transfers_write on stock.stock_transfers for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_warehouse_manager() or stock.is_warehouse_staff())
  with check (stock.is_system() or stock.is_central() or stock.is_warehouse_manager() or stock.is_warehouse_staff());
create policy transfer_lines_rw on stock.stock_transfer_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or stock_transfer_id in (select id from stock.stock_transfers))
  with check (stock.is_system() or stock.is_central()
              or stock_transfer_id in (select id from stock.stock_transfers));

create policy label_jobs_rw on stock.label_jobs for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_warehouse_manager() or stock.is_warehouse_staff())
  with check (stock.is_system() or stock.is_central() or stock.is_warehouse_manager() or stock.is_warehouse_staff());

create policy document_reversals_read on stock.document_reversals for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock.is_warehouse_manager());
create policy document_reversals_write on stock.document_reversals for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_warehouse_manager())
  with check (stock.is_system() or stock.is_central() or stock.is_warehouse_manager());
