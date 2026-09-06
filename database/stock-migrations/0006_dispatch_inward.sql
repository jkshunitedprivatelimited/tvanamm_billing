-- Stock V1 S4 (part 2) - Allocation, dispatch with a GST invoice snapshot,
-- outlet inward with discrepancy handling, backorder, and credit notes.
-- docs/architecture/franchise-owner-stock-portal.md "Allocation and dispatch",
-- "Outlet inward and discrepancies"; Core Invariants 11, 12.

-- ---- Allocation -------------------------------------------------

create type stock.allocation_status as enum ('held', 'packed', 'dispatched', 'released');

create table stock.stock_order_allocations (
  id                  uuid primary key default gen_random_uuid(),
  stock_order_line_id uuid not null references stock.stock_order_lines(id) on delete cascade,
  warehouse_id        uuid not null references stock.warehouses(id) on delete restrict,
  batch_id            uuid references stock.batches(id) on delete set null,
  qty_base            numeric(20,6) not null check (qty_base > 0),
  status              stock.allocation_status not null default 'held',
  created_at          timestamptz not null default now()
);
create index stock_order_allocations_line_idx on stock.stock_order_allocations(stock_order_line_id);

-- ---- Dispatch ------------------------------------------------

create type stock.dispatch_status as enum ('packed', 'dispatched', 'cancelled');

create table stock.stock_dispatches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_order_id  uuid not null references stock.stock_orders(id) on delete restrict,
  warehouse_id    uuid not null references stock.warehouses(id) on delete restrict,
  dispatch_number text not null,
  gst_invoice     jsonb not null default '{}'::jsonb,
  status          stock.dispatch_status not null default 'packed',
  dispatched_by   uuid,
  dispatched_at   timestamptz,
  created_at      timestamptz not null default now(),
  constraint stock_dispatches_number_uniq unique (organization_id, dispatch_number)
);
create index stock_dispatches_order_idx on stock.stock_dispatches(stock_order_id);

create table stock.stock_dispatch_lines (
  id                  uuid primary key default gen_random_uuid(),
  stock_dispatch_id   uuid not null references stock.stock_dispatches(id) on delete cascade,
  stock_order_line_id uuid not null references stock.stock_order_lines(id) on delete restrict,
  item_id             uuid not null references stock.items(id) on delete restrict,
  batch_id            uuid references stock.batches(id) on delete set null,
  qty_base            numeric(20,6) not null check (qty_base > 0)
);
create index stock_dispatch_lines_dispatch_idx on stock.stock_dispatch_lines(stock_dispatch_id);

-- ---- Outlet inward ----------------------------------------

create type stock.inward_status as enum ('draft', 'partially_received', 'received', 'closed');

create table stock.outlet_inwards (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  stock_order_id    uuid not null references stock.stock_orders(id) on delete restrict,
  stock_dispatch_id uuid not null references stock.stock_dispatches(id) on delete restrict,
  outlet_id         uuid not null,
  franchise_id      uuid not null,
  inward_number     text not null,
  status            stock.inward_status not null default 'draft',
  received_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint outlet_inwards_number_uniq unique (organization_id, inward_number)
);
create index outlet_inwards_order_idx on stock.outlet_inwards(stock_order_id);
create trigger outlet_inwards_set_updated_at before update on stock.outlet_inwards
  for each row execute function stock.set_updated_at();

create table stock.outlet_inward_lines (
  id                    uuid primary key default gen_random_uuid(),
  outlet_inward_id      uuid not null references stock.outlet_inwards(id) on delete cascade,
  stock_dispatch_line_id uuid not null references stock.stock_dispatch_lines(id) on delete restrict,
  item_id               uuid not null references stock.items(id) on delete restrict,
  accepted_qty_base     numeric(20,6) not null default 0 check (accepted_qty_base >= 0),
  short_qty_base        numeric(20,6) not null default 0 check (short_qty_base >= 0),
  damaged_qty_base      numeric(20,6) not null default 0 check (damaged_qty_base >= 0),
  excess_qty_base       numeric(20,6) not null default 0 check (excess_qty_base >= 0),
  rejected_qty_base     numeric(20,6) not null default 0 check (rejected_qty_base >= 0)
);
create index outlet_inward_lines_inward_idx on stock.outlet_inward_lines(outlet_inward_id);

-- ---- Discrepancies + credit notes ----------------------

create type stock.discrepancy_kind as enum ('short', 'damaged', 'excess', 'rejected');
create type stock.discrepancy_status as enum ('open', 'resolved');
create type stock.discrepancy_resolution as enum (
  'replacement', 'credit_note', 'approved_excess', 'return_collection', 'written_off'
);

create table stock.stock_order_discrepancies (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  outlet_inward_id    uuid not null references stock.outlet_inwards(id) on delete restrict,
  stock_order_line_id uuid not null references stock.stock_order_lines(id) on delete restrict,
  item_id             uuid not null references stock.items(id) on delete restrict,
  kind                stock.discrepancy_kind not null,
  qty_base            numeric(20,6) not null check (qty_base > 0),
  status              stock.discrepancy_status not null default 'open',
  resolution          stock.discrepancy_resolution,
  resolved_by         uuid,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index discrepancies_order_idx on stock.stock_order_discrepancies(stock_order_line_id);
create index discrepancies_open_idx on stock.stock_order_discrepancies(outlet_inward_id)
  where status = 'open';

create table stock.credit_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_order_id  uuid not null references stock.stock_orders(id) on delete restrict,
  discrepancy_id  uuid references stock.stock_order_discrepancies(id) on delete set null,
  credit_note_number text not null,
  amount_paise    bigint not null check (amount_paise > 0),
  reason          text not null,
  status          text not null default 'issued' check (status in ('issued','settled','void')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  constraint credit_notes_number_uniq unique (organization_id, credit_note_number)
);
create trigger credit_notes_no_delete before delete on stock.credit_notes
  for each row execute function stock.reject_mutation();

-- ---- Grants + RLS -------------------------------------

grant select, insert, update on
  stock.stock_order_allocations, stock.stock_dispatches, stock.stock_dispatch_lines,
  stock.outlet_inwards, stock.outlet_inward_lines, stock.stock_order_discrepancies,
  stock.credit_notes
  to stock_api;

alter table stock.stock_order_allocations    enable row level security;
alter table stock.stock_dispatches           enable row level security;
alter table stock.stock_dispatch_lines       enable row level security;
alter table stock.outlet_inwards             enable row level security;
alter table stock.outlet_inward_lines        enable row level security;
alter table stock.stock_order_discrepancies  enable row level security;
alter table stock.credit_notes               enable row level security;

create policy allocations_rw on stock.stock_order_allocations for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id))
  with check (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id));

create policy dispatches_read on stock.stock_dispatches for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.can_operate_warehouse(warehouse_id)
    or stock_order_id in (select id from stock.stock_orders)
  );
create policy dispatches_write on stock.stock_dispatches for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id))
  with check (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id));

create policy dispatch_lines_rw on stock.stock_dispatch_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or stock_dispatch_id in (select id from stock.stock_dispatches))
  with check (stock.is_system() or stock.is_central()
              or stock_dispatch_id in (select id from stock.stock_dispatches));

create policy outlet_inwards_read on stock.outlet_inwards for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_warehouse_manager()
    or stock.is_owner_of(franchise_id)
    or outlet_id = stock.ctx_uuid('outlet_id')
  );
create policy outlet_inwards_write on stock.outlet_inwards for all to stock_api
  using (
    stock.is_system() or stock.is_central()
    or stock.is_owner_of(franchise_id) or outlet_id = stock.ctx_uuid('outlet_id')
  )
  with check (
    stock.is_system() or stock.is_central()
    or stock.is_owner_of(franchise_id) or outlet_id = stock.ctx_uuid('outlet_id')
  );

create policy inward_lines_rw on stock.outlet_inward_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or outlet_inward_id in (select id from stock.outlet_inwards))
  with check (stock.is_system() or stock.is_central()
              or outlet_inward_id in (select id from stock.outlet_inwards));

create policy discrepancies_read on stock.stock_order_discrepancies for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock.is_warehouse_manager()
         or outlet_inward_id in (select id from stock.outlet_inwards));
create policy discrepancies_write on stock.stock_order_discrepancies for all to stock_api
  using (stock.is_system() or stock.is_central()
         or outlet_inward_id in (select id from stock.outlet_inwards))
  with check (stock.is_system() or stock.is_central()
              or outlet_inward_id in (select id from stock.outlet_inwards));

create policy credit_notes_read on stock.credit_notes for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock_order_id in (select id from stock.stock_orders));
create policy credit_notes_write on stock.credit_notes for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant())
  with check (stock.is_system() or stock.is_central() or stock.is_accountant());
