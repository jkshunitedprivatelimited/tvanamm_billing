-- Stock V1 S3 (part 1) - Central procurement: suppliers, purchase orders,
-- receiving with a mandatory supplier invoice number, supplier invoices whose
-- payable state is derived from immutable payments, and supplier returns.
-- docs/plans/stock-v1-build-plan.md "Central Procurement and Production" and
-- "Supplier returns"; Core Invariants 5, 12.

-- ---- Suppliers -----------------------------------------------------

create table stock.suppliers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null check (length(btrim(name)) between 1 and 200),
  gstin            text,
  contact_name     text,
  contact_phone    text,
  contact_email    text,
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  is_approved      boolean not null default false,
  is_active        boolean not null default true,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint suppliers_name_uniq unique (organization_id, name)
);
create trigger suppliers_set_updated_at before update on stock.suppliers
  for each row execute function stock.set_updated_at();

-- ---- Purchase orders ---------------------------------------------

create type stock.po_status as enum (
  'draft', 'submitted', 'approved', 'ordered',
  'partially_received', 'received', 'closed', 'cancelled'
);

create table stock.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  supplier_id      uuid not null references stock.suppliers(id) on delete restrict,
  warehouse_id     uuid not null references stock.warehouses(id) on delete restrict,
  po_number        text not null,
  status           stock.po_status not null default 'draft',
  expected_date    date,
  subtotal_paise   bigint not null default 0,
  tax_paise        bigint not null default 0,
  total_paise      bigint not null default 0,
  notes            text,
  created_by       uuid,
  submitted_by     uuid,
  approved_by      uuid,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint purchase_orders_number_uniq unique (organization_id, po_number)
);
create index purchase_orders_supplier_idx on stock.purchase_orders(supplier_id, status);
create index purchase_orders_wh_idx on stock.purchase_orders(warehouse_id, status);
create trigger purchase_orders_set_updated_at before update on stock.purchase_orders
  for each row execute function stock.set_updated_at();

create table stock.purchase_order_lines (
  id               uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references stock.purchase_orders(id) on delete cascade,
  item_id          uuid not null references stock.items(id) on delete restrict,
  order_qty_base   numeric(20,6) not null check (order_qty_base > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),  -- per base unit
  gst_rate         numeric(5,2) not null default 0,
  received_qty_base numeric(20,6) not null default 0,
  constraint po_lines_item_uniq unique (purchase_order_id, item_id)
);
create index po_lines_po_idx on stock.purchase_order_lines(purchase_order_id);

-- ---- Supplier receipts ------------------------------------------
-- A receipt without a supplier invoice number stays draft / quarantined and
-- posts nothing to sellable stock.

create type stock.receipt_status as enum ('draft', 'quarantined', 'posted', 'cancelled');

create table stock.supplier_receipts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  purchase_order_id uuid not null references stock.purchase_orders(id) on delete restrict,
  warehouse_id      uuid not null references stock.warehouses(id) on delete restrict,
  supplier_id       uuid not null references stock.suppliers(id) on delete restrict,
  receipt_number    text not null,
  supplier_invoice_number text,
  invoice_date      date,
  landed_costs      jsonb not null default '{}'::jsonb,
  status            stock.receipt_status not null default 'draft',
  idempotency_key   text not null,
  received_by       uuid,
  posted_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint supplier_receipts_number_uniq unique (organization_id, receipt_number),
  constraint supplier_receipts_idem_uniq unique (organization_id, idempotency_key)
);
create index supplier_receipts_po_idx on stock.supplier_receipts(purchase_order_id);
create trigger supplier_receipts_set_updated_at before update on stock.supplier_receipts
  for each row execute function stock.set_updated_at();

create table stock.supplier_receipt_lines (
  id                uuid primary key default gen_random_uuid(),
  supplier_receipt_id uuid not null references stock.supplier_receipts(id) on delete cascade,
  purchase_order_line_id uuid references stock.purchase_order_lines(id) on delete set null,
  item_id           uuid not null references stock.items(id) on delete restrict,
  batch_code        text,
  manufacture_date  date,
  expiry_date       date,
  accepted_qty_base numeric(20,6) not null default 0 check (accepted_qty_base >= 0),
  damaged_qty_base  numeric(20,6) not null default 0 check (damaged_qty_base >= 0),
  rejected_qty_base numeric(20,6) not null default 0 check (rejected_qty_base >= 0),
  unit_cost_paise   bigint not null check (unit_cost_paise >= 0),
  manual_entry_reason text
);
create index supplier_receipt_lines_receipt_idx on stock.supplier_receipt_lines(supplier_receipt_id);

-- ---- Supplier invoices + immutable payments ------------------

create type stock.payable_state as enum ('unpaid', 'partially_paid', 'paid', 'overdue', 'disputed');

create table stock.supplier_invoices (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  supplier_id       uuid not null references stock.suppliers(id) on delete restrict,
  supplier_receipt_id uuid references stock.supplier_receipts(id) on delete set null,
  invoice_number    text not null,
  invoice_date      date not null,
  due_date          date,
  amount_paise      bigint not null check (amount_paise >= 0),
  is_disputed       boolean not null default false,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint supplier_invoices_number_uniq unique (organization_id, supplier_id, invoice_number)
);
create trigger supplier_invoices_set_updated_at before update on stock.supplier_invoices
  for each row execute function stock.set_updated_at();

create table stock.supplier_payments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  supplier_invoice_id uuid not null references stock.supplier_invoices(id) on delete restrict,
  amount_paise      bigint not null check (amount_paise > 0),
  method            text not null check (method in ('bank_transfer','upi','cheque','cash','adjustment','credit_note')),
  reference         text,
  paid_on           date not null,
  recorded_by       uuid,
  created_at        timestamptz not null default now()
);
create index supplier_payments_invoice_idx on stock.supplier_payments(supplier_invoice_id);
create trigger supplier_payments_no_update before update on stock.supplier_payments
  for each row execute function stock.reject_mutation();
create trigger supplier_payments_no_delete before delete on stock.supplier_payments
  for each row execute function stock.reject_mutation();

-- Payable state derived from immutable payments; never written directly.
create or replace function stock.supplier_invoice_state(inv stock.supplier_invoices)
returns stock.payable_state language sql stable as $$
  select case
    when inv.is_disputed then 'disputed'::stock.payable_state
    when coalesce((select sum(amount_paise) from stock.supplier_payments p
                    where p.supplier_invoice_id = inv.id), 0) >= inv.amount_paise then 'paid'
    when coalesce((select sum(amount_paise) from stock.supplier_payments p
                    where p.supplier_invoice_id = inv.id), 0) > 0 then 'partially_paid'
    when inv.due_date is not null and inv.due_date < current_date then 'overdue'
    else 'unpaid'
  end
$$;

-- ---- Supplier returns -----------------------------------------

create type stock.supplier_return_status as enum (
  'requested', 'dispatched', 'resolved', 'rejected'
);
create type stock.supplier_return_resolution as enum (
  'replacement', 'credit_note', 'refund', 'supplier_rejected'
);

create table stock.supplier_returns (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  supplier_id       uuid not null references stock.suppliers(id) on delete restrict,
  purchase_order_id uuid references stock.purchase_orders(id) on delete set null,
  supplier_receipt_id uuid references stock.supplier_receipts(id) on delete set null,
  supplier_invoice_id uuid references stock.supplier_invoices(id) on delete set null,
  warehouse_id      uuid not null references stock.warehouses(id) on delete restrict,
  item_id           uuid not null references stock.items(id) on delete restrict,
  batch_id          uuid references stock.batches(id) on delete set null,
  quantity_base     numeric(20,6) not null check (quantity_base > 0),
  reason            text not null check (reason in ('damaged','wrong_item','expired','rejected','quality_failed')),
  status            stock.supplier_return_status not null default 'requested',
  resolution        stock.supplier_return_resolution,
  evidence_url      text,
  requested_by      uuid,
  confirmed_by      uuid,
  resolved_by       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index supplier_returns_supplier_idx on stock.supplier_returns(supplier_id, status);
create trigger supplier_returns_set_updated_at before update on stock.supplier_returns
  for each row execute function stock.set_updated_at();

-- ---- Grants + RLS -----------------------------------------

grant select, insert, update on
  stock.suppliers, stock.purchase_orders, stock.purchase_order_lines,
  stock.supplier_receipts, stock.supplier_receipt_lines,
  stock.supplier_invoices, stock.supplier_returns
  to stock_api;
grant select, insert on stock.supplier_payments to stock_api;

alter table stock.suppliers              enable row level security;
alter table stock.purchase_orders        enable row level security;
alter table stock.purchase_order_lines   enable row level security;
alter table stock.supplier_receipts      enable row level security;
alter table stock.supplier_receipt_lines enable row level security;
alter table stock.supplier_invoices      enable row level security;
alter table stock.supplier_payments      enable row level security;
alter table stock.supplier_returns       enable row level security;

-- Procurement is Central / Warehouse-Manager territory; Accountant reads
-- invoices/payments and records payments; Warehouse Staff cannot mark paid.
create policy suppliers_read on stock.suppliers for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock.is_warehouse_manager() or stock.is_warehouse_staff());
create policy suppliers_write on stock.suppliers for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_warehouse_manager())
  with check (stock.is_system() or stock.is_central() or stock.is_warehouse_manager());

create policy po_read on stock.purchase_orders for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock.can_operate_warehouse(warehouse_id));
create policy po_write on stock.purchase_orders for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id))
  with check (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id));

create policy po_lines_rw on stock.purchase_order_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or purchase_order_id in (select id from stock.purchase_orders))
  with check (stock.is_system() or stock.is_central()
              or purchase_order_id in (select id from stock.purchase_orders));

create policy receipts_read on stock.supplier_receipts for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock.can_operate_warehouse(warehouse_id));
create policy receipts_write on stock.supplier_receipts for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id))
  with check (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id));

create policy receipt_lines_rw on stock.supplier_receipt_lines for all to stock_api
  using (stock.is_system() or stock.is_central()
         or supplier_receipt_id in (select id from stock.supplier_receipts))
  with check (stock.is_system() or stock.is_central()
              or supplier_receipt_id in (select id from stock.supplier_receipts));

create policy supplier_invoices_read on stock.supplier_invoices for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock.is_warehouse_manager());
create policy supplier_invoices_write on stock.supplier_invoices for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant())
  with check (stock.is_system() or stock.is_central() or stock.is_accountant());

create policy supplier_payments_read on stock.supplier_payments for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant());
create policy supplier_payments_insert on stock.supplier_payments for insert to stock_api
  with check (stock.is_system() or stock.is_central() or stock.is_accountant());

create policy supplier_returns_read on stock.supplier_returns for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant()
         or stock.can_operate_warehouse(warehouse_id));
create policy supplier_returns_write on stock.supplier_returns for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id))
  with check (stock.is_system() or stock.is_central() or stock.can_operate_warehouse(warehouse_id));
