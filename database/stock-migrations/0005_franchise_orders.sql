-- Stock V1 S4 (part 1) - Franchise commerce: the JKSH supply catalog, centrally
-- configured delivery-charge rules, one-outlet prepaid stock orders, and the
-- Razorpay payment boundary with server-side verification and a replay-safe
-- webhook inbox.
-- docs/architecture/franchise-owner-stock-portal.md "JKSH Stock Order Flow" and
-- "Razorpay Boundary"; docs/plans/stock-v1-build-plan.md "Razorpay and payment".

-- ---- Delivery-charge rules ------------------------------------

create type stock.delivery_rule_kind as enum ('flat', 'per_outlet', 'free_over_threshold', 'free');

create table stock.delivery_charge_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null,
  kind             stock.delivery_rule_kind not null,
  amount_paise     bigint not null default 0 check (amount_paise >= 0),
  free_over_paise  bigint check (free_over_paise is null or free_over_paise >= 0),
  version          integer not null default 1,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint delivery_rule_threshold_shape check (
    kind <> 'free_over_threshold' or free_over_paise is not null
  )
);
create trigger delivery_charge_rules_set_updated_at before update on stock.delivery_charge_rules
  for each row execute function stock.set_updated_at();

-- ---- Supply catalog -----------------------------------------

create table stock.supply_catalog_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  brand_id         uuid,
  item_id          uuid not null references stock.items(id) on delete restrict,
  gst_inclusive_price_paise bigint not null check (gst_inclusive_price_paise >= 0),
  gst_rate         numeric(5,2) not null default 0,
  hsn_code         text,
  order_pack_base  numeric(20,6) not null default 1 check (order_pack_base > 0),
  delivery_rule_id uuid references stock.delivery_charge_rules(id) on delete set null,
  is_available     boolean not null default true,
  version          integer not null default 1,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint supply_catalog_items_item_uniq unique (organization_id, item_id)
);
create index supply_catalog_items_avail_idx on stock.supply_catalog_items(organization_id)
  where is_available;
create trigger supply_catalog_items_set_updated_at before update on stock.supply_catalog_items
  for each row execute function stock.set_updated_at();

-- Optional per-outlet availability override; absent row means "available".
create table stock.supply_catalog_outlet_blocks (
  supply_catalog_item_id uuid not null references stock.supply_catalog_items(id) on delete cascade,
  outlet_id              uuid not null,
  primary key (supply_catalog_item_id, outlet_id)
);

-- ---- Stock orders -----------------------------------------

create type stock.stock_order_status as enum (
  'draft', 'awaiting_payment', 'payment_pending', 'paid', 'approved', 'allocated',
  'packed', 'partially_dispatched', 'dispatched', 'partially_received', 'received',
  'closed', 'cancelled', 'expired', 'failed'
);

create table stock.stock_orders (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  outlet_id             uuid not null,
  franchise_id          uuid not null,
  order_number          text not null,
  status                stock.stock_order_status not null default 'draft',
  subtotal_paise        bigint not null default 0,
  tax_paise             bigint not null default 0,
  delivery_paise        bigint not null default 0,
  total_paise           bigint not null default 0,
  delivery_rule_id      uuid references stock.delivery_charge_rules(id) on delete set null,
  delivery_rule_version integer,
  razorpay_order_id     text,
  razorpay_payment_id   text,
  captured_amount_paise bigint,
  currency              text not null default 'INR',
  revision              integer not null default 1,
  suggestion_id         uuid,
  created_by            uuid,
  paid_at               timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint stock_orders_number_uniq unique (organization_id, order_number),
  constraint stock_orders_rzp_order_uniq unique (razorpay_order_id),
  constraint stock_orders_rzp_payment_uniq unique (razorpay_payment_id)
);
create index stock_orders_outlet_idx on stock.stock_orders(outlet_id, status);
create index stock_orders_franchise_idx on stock.stock_orders(franchise_id, status);
create trigger stock_orders_set_updated_at before update on stock.stock_orders
  for each row execute function stock.set_updated_at();

create table stock.stock_order_lines (
  id                 uuid primary key default gen_random_uuid(),
  stock_order_id     uuid not null references stock.stock_orders(id) on delete cascade,
  supply_catalog_item_id uuid not null references stock.supply_catalog_items(id) on delete restrict,
  item_id            uuid not null references stock.items(id) on delete restrict,
  qty_base           numeric(20,6) not null check (qty_base > 0),
  unit_price_paise   bigint not null check (unit_price_paise >= 0),   -- GST-inclusive snapshot
  gst_rate           numeric(5,2) not null default 0,
  hsn_code           text,
  allocated_qty_base numeric(20,6) not null default 0,
  dispatched_qty_base numeric(20,6) not null default 0,
  received_qty_base  numeric(20,6) not null default 0,
  constraint stock_order_lines_item_uniq unique (stock_order_id, supply_catalog_item_id)
);
create index stock_order_lines_order_idx on stock.stock_order_lines(stock_order_id);

-- ---- Razorpay payments + webhook inbox -----------------

create type stock.rzp_payment_status as enum (
  'created', 'authorized', 'captured', 'failed', 'refunded'
);

create table stock.stock_order_payments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  stock_order_id      uuid not null references stock.stock_orders(id) on delete restrict,
  razorpay_order_id   text not null,
  razorpay_payment_id text,
  amount_paise        bigint not null check (amount_paise >= 0),
  currency            text not null default 'INR',
  status              stock.rzp_payment_status not null default 'created',
  signature_verified  boolean not null default false,
  source_event_id     text,
  created_at          timestamptz not null default now(),
  constraint stock_order_payments_pay_uniq unique (razorpay_payment_id),
  constraint stock_order_payments_event_uniq unique (source_event_id)
);
create index stock_order_payments_order_idx on stock.stock_order_payments(stock_order_id);
create trigger stock_order_payments_no_delete before delete on stock.stock_order_payments
  for each row execute function stock.reject_mutation();

create table stock.razorpay_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  event_id      text not null,
  event_type    text not null,
  payload       jsonb not null,
  signature_verified boolean not null default false,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  process_note  text,
  constraint razorpay_webhook_events_uniq unique (event_id)
);
create index razorpay_webhook_events_pending_idx on stock.razorpay_webhook_events(received_at)
  where processed_at is null;

-- ---- Grants + RLS -------------------------------------

grant select, insert, update on
  stock.delivery_charge_rules, stock.supply_catalog_items,
  stock.supply_catalog_outlet_blocks, stock.stock_orders, stock.stock_order_lines
  to stock_api;
grant select, insert, update on stock.stock_order_payments to stock_api;
grant select, insert, update on stock.razorpay_webhook_events to stock_api;

alter table stock.delivery_charge_rules        enable row level security;
alter table stock.supply_catalog_items         enable row level security;
alter table stock.supply_catalog_outlet_blocks enable row level security;
alter table stock.stock_orders                 enable row level security;
alter table stock.stock_order_lines            enable row level security;
alter table stock.stock_order_payments         enable row level security;
alter table stock.razorpay_webhook_events      enable row level security;

create policy delivery_rules_read on stock.delivery_charge_rules for select to stock_api
  using (true);
create policy delivery_rules_write on stock.delivery_charge_rules for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());

create policy supply_catalog_read on stock.supply_catalog_items for select to stock_api using (true);
create policy supply_catalog_write on stock.supply_catalog_items for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());
create policy supply_catalog_blocks_read on stock.supply_catalog_outlet_blocks for select to stock_api
  using (true);
create policy supply_catalog_blocks_write on stock.supply_catalog_outlet_blocks for all to stock_api
  using (stock.is_system() or stock.is_central()) with check (stock.is_system() or stock.is_central());

-- An owner sees and manages only their own franchise's orders; Central and
-- warehouse oversight see all; the terminal outlet sees its own.
create policy stock_orders_read on stock.stock_orders for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_warehouse_manager()
    or stock.is_owner_of(franchise_id)
    or outlet_id = stock.ctx_uuid('outlet_id')
  );
create policy stock_orders_write on stock.stock_orders for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_owner_of(franchise_id))
  with check (stock.is_system() or stock.is_central() or stock.is_owner_of(franchise_id));

create policy stock_order_lines_rw on stock.stock_order_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or stock_order_id in (select id from stock.stock_orders))
  with check (stock.is_system() or stock.is_central()
              or stock_order_id in (select id from stock.stock_orders));

create policy stock_order_payments_read on stock.stock_order_payments for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock_order_id in (select id from stock.stock_orders)
  );
create policy stock_order_payments_write on stock.stock_order_payments for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant())
  with check (stock.is_system() or stock.is_central() or stock.is_accountant());

create policy razorpay_webhook_events_rw on stock.razorpay_webhook_events for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());
