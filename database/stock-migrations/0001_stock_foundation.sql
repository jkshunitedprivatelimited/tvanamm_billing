-- Stock V1 S1 - Foundation: schemas, least-privilege role, tenant context / RLS
-- helpers, identity projection, capabilities, audit, and the signed inbox/outbox.
-- docs/plans/stock-v1-build-plan.md "S1 - Foundation".
--
-- Stock is a physically separate database. It never references a Billing table.
-- The only data crossing the boundary is versioned, signed, idempotent events
-- landing in stock_inbox.events / leaving through stock_outbox.events.

create schema if not exists stock;
create schema if not exists stock_audit;
create schema if not exists stock_outbox;
create schema if not exists stock_inbox;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---- Least-privilege API role -----------------------------------------------
-- The pooled connection authenticates as the project owner and does
-- `set local role stock_api` per transaction so RLS + grants apply.
do $$
begin
  if not exists (select from pg_roles where rolname = 'stock_api') then
    create role stock_api nologin;
  end if;
  execute format('grant stock_api to %I', current_user);
end
$$;

-- Supabase provides these; stub them on plain Postgres (CI / local integration).
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema stock, stock_audit, stock_outbox, stock_inbox to stock_api;

-- ---- Shared triggers ------------------------------------------------------

create or replace function stock.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function stock.reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name;
end;
$$;

-- ---- Per-transaction authorization context ------------------------------
-- app.request = 'system' | 'admin' | 'operator'
-- app.account_id, app.role, app.organization_id, app.franchise_id,
-- app.outlet_id, app.operator_employee_id, app.warehouse_ids (csv)

create or replace function stock.ctx(name text) returns text
  language sql stable as $$ select nullif(current_setting('app.' || name, true), '') $$;

create or replace function stock.ctx_uuid(name text) returns uuid
  language sql stable as $$ select nullif(current_setting('app.' || name, true), '')::uuid $$;

create or replace function stock.is_system() returns boolean
  language sql stable as $$ select stock.ctx('request') = 'system' $$;

create or replace function stock.is_central() returns boolean
  language sql stable as $$ select stock.ctx('role') = 'central_admin' $$;

create or replace function stock.is_accountant() returns boolean
  language sql stable as $$ select stock.ctx('role') = 'accountant' $$;

create or replace function stock.is_warehouse_manager() returns boolean
  language sql stable as $$ select stock.ctx('role') = 'warehouse_manager' $$;

create or replace function stock.is_warehouse_staff() returns boolean
  language sql stable as $$ select stock.ctx('role') = 'warehouse_staff' $$;

create or replace function stock.is_owner_of(f uuid) returns boolean
  language sql stable as $$
    select stock.ctx('role') = 'franchise_owner'
       and f is not null and f = stock.ctx_uuid('franchise_id')
  $$;

create or replace function stock.actor_warehouse_ids() returns uuid[]
  language sql stable as $$
    select coalesce(
      (select array_agg(t::uuid)
         from unnest(string_to_array(coalesce(stock.ctx('warehouse_ids'), ''), ',')) as t
        where btrim(t) <> ''),
      '{}'::uuid[])
  $$;

create or replace function stock.has_warehouse(w uuid) returns boolean
  language sql stable as $$ select w is not null and w = any (stock.actor_warehouse_ids()) $$;

-- Any warehouse operator (manager or staff) with the warehouse assigned.
create or replace function stock.can_operate_warehouse(w uuid) returns boolean
  language sql stable as $$
    select stock.is_system() or stock.is_central()
       or ((stock.is_warehouse_manager() or stock.is_warehouse_staff())
           and stock.has_warehouse(w))
  $$;

alter table stock.schema_migrations enable row level security;

-- ---- Identity projection ------------------------------------------------
-- A Billing Identity account/employee resolved to its Stock-local access.
-- Stock does not create a second login; this row is written from a verified
-- Billing session (or a Central Admin grant for warehouse roles).

create type stock.actor_role as enum (
  'central_admin', 'accountant', 'franchise_owner',
  'warehouse_manager', 'warehouse_staff', 'store_employee'
);

create table stock.identity_projection (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid,
  employee_id      uuid,
  role             stock.actor_role not null,
  organization_id  uuid not null,
  franchise_id     uuid,
  display_name     text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint identity_projection_subject check (
    (account_id is not null and employee_id is null) or
    (account_id is null and employee_id is not null)
  ),
  constraint identity_projection_owner_scope check (
    role <> 'franchise_owner' or franchise_id is not null
  )
);
create unique index identity_projection_account_uniq
  on stock.identity_projection(account_id) where account_id is not null;
create unique index identity_projection_employee_uniq
  on stock.identity_projection(employee_id) where employee_id is not null;
create trigger identity_projection_set_updated_at before update on stock.identity_projection
  for each row execute function stock.set_updated_at();

alter table stock.identity_projection enable row level security;
grant select, insert, update on stock.identity_projection to stock_api;

create policy identity_projection_read on stock.identity_projection for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or account_id = stock.ctx_uuid('account_id')
    or employee_id = stock.ctx_uuid('operator_employee_id')
  );
create policy identity_projection_write on stock.identity_projection for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());

-- Warehouse assignments for warehouse_manager / warehouse_staff projections.
-- The FK to stock.warehouses is added in S2 (Inventory Core) once that table
-- exists; the warehouse_id is a bare uuid until then.
create table stock.warehouse_assignments (
  projection_id uuid not null references stock.identity_projection(id) on delete cascade,
  warehouse_id  uuid not null,
  created_at    timestamptz not null default now(),
  primary key (projection_id, warehouse_id)
);
alter table stock.warehouse_assignments enable row level security;
grant select, insert, delete on stock.warehouse_assignments to stock_api;
create policy warehouse_assignments_read on stock.warehouse_assignments for select to stock_api
  using (
    stock.is_system() or stock.is_central()
    or projection_id in (
      select id from stock.identity_projection
       where account_id = stock.ctx_uuid('account_id')
          or employee_id = stock.ctx_uuid('operator_employee_id')
    )
  );
create policy warehouse_assignments_write on stock.warehouse_assignments for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());

-- ---- Capabilities ------------------------------------------------------
-- Mirrors STOCK_ROLE_CAPABILITIES in @jksh/contracts. Application code checks
-- the TypeScript map; these rows let RLS and reports resolve the same truth.

create table stock.capabilities (
  code        text primary key,
  description text not null
);

create table stock.role_capabilities (
  role       stock.actor_role not null,
  capability text not null references stock.capabilities(code) on delete cascade,
  primary key (role, capability)
);

alter table stock.capabilities enable row level security;
alter table stock.role_capabilities enable row level security;
grant select on stock.capabilities, stock.role_capabilities to stock_api;
create policy capabilities_read on stock.capabilities for select to stock_api using (true);
create policy role_capabilities_read on stock.role_capabilities for select to stock_api using (true);

insert into stock.capabilities (code, description) values
  ('stock.config.manage',        'Manage Stock configuration, warehouses, and outlet tracking'),
  ('stock.master.manage',        'Manage units, items, barcodes, and supply rules'),
  ('stock.recipe.manage',        'Author, version, and publish recipes'),
  ('stock.recipe.read',          'View published recipes'),
  ('stock.supplier.manage',      'Manage suppliers and purchase orders'),
  ('stock.receiving.operate',    'Receive supplier / transfer stock into a warehouse'),
  ('stock.production.operate',   'Run production orders and record genealogy'),
  ('stock.dispatch.operate',     'Allocate, pack, and dispatch warehouse stock'),
  ('stock.count.operate',        'Record physical counts and cycle counts'),
  ('stock.wastage.operate',      'Record wastage and cancellation losses'),
  ('stock.transfer.operate',     'Move stock between JKSH-owned locations'),
  ('stock.adjustment.approve',   'Approve exceptional stock adjustments'),
  ('stock.supplier_payment.record', 'Record supplier invoice payments and allocations'),
  ('stock.order.create',         'Create and prepay franchise supply orders'),
  ('stock.order.oversee',        'Approve, allocate, and oversee franchise supply orders'),
  ('stock.inward.operate',       'Record outlet inward against a dispatch'),
  ('stock.local_inward.record',  'Record local (non-JKSH) outlet inward'),
  ('stock.local_inward.review',  'Review and complete employee local inward'),
  ('stock.return.request',       'Request return-to-inventory for eligible goods'),
  ('stock.return.approve',       'Approve / reject returns and recalls'),
  ('stock.recall.manage',        'Draft, activate, and close recalls'),
  ('stock.report.read',          'Read Stock reports, valuation, and audit'),
  ('stock.inventory.read',       'Read inventory balances and ledger for authorized scope')
on conflict (code) do nothing;

insert into stock.role_capabilities (role, capability)
select 'central_admin'::stock.actor_role, c.code
from stock.capabilities c
on conflict do nothing;

insert into stock.role_capabilities (role, capability) values
  ('accountant', 'stock.supplier_payment.record'),
  ('accountant', 'stock.report.read'),
  ('accountant', 'stock.inventory.read'),
  ('accountant', 'stock.recipe.read'),

  ('warehouse_manager', 'stock.supplier.manage'),
  ('warehouse_manager', 'stock.receiving.operate'),
  ('warehouse_manager', 'stock.production.operate'),
  ('warehouse_manager', 'stock.dispatch.operate'),
  ('warehouse_manager', 'stock.count.operate'),
  ('warehouse_manager', 'stock.wastage.operate'),
  ('warehouse_manager', 'stock.transfer.operate'),
  ('warehouse_manager', 'stock.adjustment.approve'),
  ('warehouse_manager', 'stock.order.oversee'),
  ('warehouse_manager', 'stock.return.approve'),
  ('warehouse_manager', 'stock.recall.manage'),
  ('warehouse_manager', 'stock.report.read'),
  ('warehouse_manager', 'stock.inventory.read'),
  ('warehouse_manager', 'stock.recipe.read'),

  ('warehouse_staff', 'stock.receiving.operate'),
  ('warehouse_staff', 'stock.production.operate'),
  ('warehouse_staff', 'stock.dispatch.operate'),
  ('warehouse_staff', 'stock.count.operate'),
  ('warehouse_staff', 'stock.wastage.operate'),
  ('warehouse_staff', 'stock.transfer.operate'),
  ('warehouse_staff', 'stock.inventory.read'),
  ('warehouse_staff', 'stock.recipe.read'),

  ('franchise_owner', 'stock.order.create'),
  ('franchise_owner', 'stock.order.oversee'),
  ('franchise_owner', 'stock.inward.operate'),
  ('franchise_owner', 'stock.local_inward.record'),
  ('franchise_owner', 'stock.local_inward.review'),
  ('franchise_owner', 'stock.return.request'),
  ('franchise_owner', 'stock.return.approve'),
  ('franchise_owner', 'stock.count.operate'),
  ('franchise_owner', 'stock.wastage.operate'),
  ('franchise_owner', 'stock.report.read'),
  ('franchise_owner', 'stock.inventory.read'),
  ('franchise_owner', 'stock.recipe.read'),

  ('store_employee', 'stock.inward.operate'),
  ('store_employee', 'stock.local_inward.record'),
  ('store_employee', 'stock.return.request'),
  ('store_employee', 'stock.count.operate'),
  ('store_employee', 'stock.wastage.operate'),
  ('store_employee', 'stock.inventory.read'),
  ('store_employee', 'stock.recipe.read')
on conflict do nothing;

-- ---- Audit -----------------------------------------------------------
-- Append-only. Ids referenced bare (no cross-schema FKs into projection).

create table stock_audit.events (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor_request   text not null,
  account_id      uuid,
  employee_id     uuid,
  organization_id uuid,
  franchise_id    uuid,
  outlet_id       uuid,
  warehouse_id    uuid,
  action          text not null,
  subject_type    text,
  subject_id      uuid,
  request_id      text,
  data            jsonb not null default '{}'::jsonb
);
create index stock_audit_events_subject_idx on stock_audit.events(subject_type, subject_id, occurred_at desc);
create index stock_audit_events_org_idx on stock_audit.events(organization_id, occurred_at desc);
create trigger stock_audit_events_no_update before update on stock_audit.events
  for each row execute function stock.reject_mutation();
create trigger stock_audit_events_no_delete before delete on stock_audit.events
  for each row execute function stock.reject_mutation();

alter table stock_audit.events enable row level security;
grant select, insert on stock_audit.events to stock_api;
create policy stock_audit_events_read on stock_audit.events for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or stock.is_owner_of(franchise_id)
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
  );
create policy stock_audit_events_insert on stock_audit.events for insert to stock_api
  with check (true);

-- ---- Outbox (Stock -> Billing / Stock consumers) --------------------

create table stock_outbox.events (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  aggregate_type  text not null,
  aggregate_id    uuid not null,
  event_type      text not null,
  event_version   integer not null default 1,
  payload         jsonb not null,
  signature       text,
  correlation_id  uuid,
  delivered_at    timestamptz,
  attempts        integer not null default 0,
  last_error      text,
  dead_lettered_at timestamptz
);
create index stock_outbox_pending_idx on stock_outbox.events(created_at)
  where delivered_at is null and dead_lettered_at is null;
create index stock_outbox_aggregate_idx on stock_outbox.events(aggregate_type, aggregate_id, created_at);

alter table stock_outbox.events enable row level security;
grant select, insert, update on stock_outbox.events to stock_api;
create policy stock_outbox_events_rw on stock_outbox.events for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());

-- ---- Inbox (Billing -> Stock) --------------------------------------
-- One row per source event id. Reprocessing a delivered event is a no-op.

create table stock_inbox.events (
  id                uuid primary key default gen_random_uuid(),
  source            text not null default 'billing',
  source_event_id   uuid not null,
  event_type        text not null,
  event_version     integer not null default 1,
  received_at       timestamptz not null default now(),
  payload           jsonb not null,
  signature         text,
  signature_verified boolean not null default false,
  correlation_id    uuid,
  processed_at      timestamptz,
  process_result    jsonb,
  attempts          integer not null default 0,
  last_error        text,
  dead_lettered_at  timestamptz,
  constraint stock_inbox_events_source_uniq unique (source, source_event_id)
);
create index stock_inbox_pending_idx on stock_inbox.events(received_at)
  where processed_at is null and dead_lettered_at is null;

alter table stock_inbox.events enable row level security;
grant select, insert, update on stock_inbox.events to stock_api;
create policy stock_inbox_events_rw on stock_inbox.events for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());
