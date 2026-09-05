-- Billing V1 Stage 3 - Bills, lines, add-ons, discounts, payments, receipt
-- allocation. docs/plans/billing-data-api-plan.md §7-8.
--
-- A completed bill and everything it owns is append-only and immutable. There
-- is no bill update / delete / void path. Retries are absorbed by a
-- (outlet, idempotency_key) unique key. Receipt numbers are allocated
-- server-side per outlet / terminal / business date and can never collide.

create type billing.bill_payment_method as enum ('cash', 'upi');
create type billing.discount_kind        as enum ('fixed', 'percent');
create type billing.discount_scope       as enum ('line', 'bill');

create table billing.receipt_sequences (
  outlet_id     uuid not null references billing.outlets(id) on delete restrict,
  terminal_id   uuid not null references identity.terminals(id) on delete restrict,
  business_date date not null,
  prefix        text not null,
  last_seq      integer not null default 0,
  primary key (outlet_id, terminal_id, business_date)
);

create table billing.bills (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references billing.organizations(id) on delete restrict,
  franchise_id       uuid references billing.franchises(id) on delete restrict,
  outlet_id          uuid not null references billing.outlets(id) on delete restrict,
  terminal_id        uuid not null references identity.terminals(id) on delete restrict,
  employee_id        uuid not null references identity.store_employees(id) on delete restrict,
  employee_name      text not null,
  shift_id           uuid references billing.employee_shifts(id) on delete set null,
  cash_session_id    uuid references billing.cash_sessions(id) on delete set null,
  receipt_number     text not null,
  business_date      date not null,
  menu_version       bigint not null,
  customer_name      text,
  customer_mobile    text,
  subtotal           numeric(12,2) not null check (subtotal >= 0),
  discount_total     numeric(12,2) not null default 0 check (discount_total >= 0),
  pre_round_total    numeric(12,2) not null check (pre_round_total >= 0),
  round_adjustment   numeric(12,2) not null default 0,
  final_total        numeric(12,2) not null check (final_total >= 0),
  payment_method     billing.bill_payment_method,     -- null only for a complimentary bill
  is_complimentary   boolean not null default false,
  is_offline         boolean not null default false,
  idempotency_key    text not null,
  terminal_occurred_at timestamptz not null,
  committed_at       timestamptz not null default now(),
  correlation_id     uuid not null,
  constraint bills_outlet_idem_uniq unique (outlet_id, idempotency_key),
  constraint bills_receipt_uniq unique (outlet_id, receipt_number),
  constraint bills_payment_shape check (
    (is_complimentary and payment_method is null and final_total = 0)
    or (not is_complimentary and payment_method is not null and final_total > 0)
  )
);
create index bills_outlet_date_idx on billing.bills(outlet_id, business_date desc, committed_at desc);
create index bills_shift_idx on billing.bills(shift_id);

create table billing.bill_lines (
  id                   uuid primary key default gen_random_uuid(),
  bill_id              uuid not null references billing.bills(id) on delete restrict,
  line_no              integer not null,
  catalog_item_id      uuid not null,
  item_name            text not null,
  quantity             integer not null check (quantity > 0),
  unit_price           numeric(12,2) not null check (unit_price >= 0),   -- GST-inclusive
  gst_rate             numeric(5,2) not null default 0,
  base_total           numeric(12,2) not null check (base_total >= 0),
  discount             numeric(12,2) not null default 0 check (discount >= 0),
  final_total          numeric(12,2) not null check (final_total >= 0),
  note                 text,
  stock_recipe_id      uuid,
  stock_recipe_version integer,
  constraint bill_lines_bill_line_uniq unique (bill_id, line_no)
);
create index bill_lines_bill_idx on billing.bill_lines(bill_id);

create table billing.bill_line_addons (
  id            uuid primary key default gen_random_uuid(),
  bill_line_id  uuid not null references billing.bill_lines(id) on delete restrict,
  addon_id      uuid not null,
  addon_name    text not null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price >= 0),
  total         numeric(12,2) not null check (total >= 0)
);
create index bill_line_addons_line_idx on billing.bill_line_addons(bill_line_id);

create table billing.bill_discounts (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references billing.bills(id) on delete restrict,
  bill_line_id uuid references billing.bill_lines(id) on delete restrict,
  scope        billing.discount_scope not null,
  kind         billing.discount_kind not null,
  input_value  numeric(12,2) not null,
  amount       numeric(12,2) not null check (amount >= 0),
  reason       text not null,
  constraint bill_discounts_scope_shape check (
    (scope = 'line' and bill_line_id is not null) or (scope = 'bill' and bill_line_id is null)
  )
);
create index bill_discounts_bill_idx on billing.bill_discounts(bill_id);

create table billing.payments (
  id             uuid primary key default gen_random_uuid(),
  bill_id        uuid not null references billing.bills(id) on delete restrict,
  method         billing.bill_payment_method not null,
  amount         numeric(12,2) not null check (amount > 0),
  round_adjustment numeric(12,2) not null default 0,
  reference      text,                       -- optional for a UPI sale
  captured_at    timestamptz not null default now(),
  constraint payments_bill_uniq unique (bill_id)
);

-- Immutability: no row in any of these tables may be updated or deleted.
create trigger receipt_sequences_no_delete before delete on billing.receipt_sequences
  for each row execute function identity.reject_mutation();
create trigger bills_no_update before update on billing.bills
  for each row execute function identity.reject_mutation();
create trigger bills_no_delete before delete on billing.bills
  for each row execute function identity.reject_mutation();
create trigger bill_lines_no_update before update on billing.bill_lines
  for each row execute function identity.reject_mutation();
create trigger bill_lines_no_delete before delete on billing.bill_lines
  for each row execute function identity.reject_mutation();
create trigger bill_line_addons_no_change before update or delete on billing.bill_line_addons
  for each row execute function identity.reject_mutation();
create trigger bill_discounts_no_change before update or delete on billing.bill_discounts
  for each row execute function identity.reject_mutation();
create trigger payments_no_change before update or delete on billing.payments
  for each row execute function identity.reject_mutation();

grant select, insert on
  billing.bills, billing.bill_lines, billing.bill_line_addons, billing.bill_discounts,
  billing.payments
  to identity_api;
grant select, insert, update on billing.receipt_sequences to identity_api;

alter table billing.receipt_sequences enable row level security;
alter table billing.bills             enable row level security;
alter table billing.bill_lines        enable row level security;
alter table billing.bill_line_addons  enable row level security;
alter table billing.bill_discounts    enable row level security;
alter table billing.payments          enable row level security;

create policy receipt_sequences_rw on billing.receipt_sequences for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
) with check (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
);

create policy bills_read on billing.bills for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy bills_insert on billing.bills for insert to identity_api with check (
  outlet_id = identity.ctx_uuid('outlet_id') or identity.is_owner_of(franchise_id)
);

-- Child rows follow their bill.
create policy bill_lines_read on billing.bill_lines for select to identity_api
  using (bill_id in (select id from billing.bills));
create policy bill_lines_insert on billing.bill_lines for insert to identity_api
  with check (bill_id in (select id from billing.bills));
create policy bill_line_addons_read on billing.bill_line_addons for select to identity_api
  using (bill_line_id in (select id from billing.bill_lines));
create policy bill_line_addons_insert on billing.bill_line_addons for insert to identity_api
  with check (bill_line_id in (select id from billing.bill_lines));
create policy bill_discounts_read on billing.bill_discounts for select to identity_api
  using (bill_id in (select id from billing.bills));
create policy bill_discounts_insert on billing.bill_discounts for insert to identity_api
  with check (bill_id in (select id from billing.bills));
create policy payments_read on billing.payments for select to identity_api
  using (bill_id in (select id from billing.bills));
create policy payments_insert on billing.payments for insert to identity_api
  with check (bill_id in (select id from billing.bills));
