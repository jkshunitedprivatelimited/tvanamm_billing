-- Stock V1 S7 - Offline draft queue, feature flags, reconciliation runs, and
-- dead-letter bookkeeping for the cross-system event pipeline.
-- docs/plans/stock-v1-build-plan.md "S7 - Offline, Hardening, and Pilot",
-- "Offline and Reliability".

-- ---- Durable offline draft queue -----------------------------

create type stock.offline_draft_status as enum ('queued', 'applied', 'rejected', 'superseded');

create table stock.offline_drafts (
  id              uuid primary key default gen_random_uuid(),
  device_id       text not null,
  organization_id uuid not null,
  outlet_id       uuid,
  warehouse_id    uuid,
  kind            text not null check (kind in
    ('local_inward', 'wastage', 'count_line', 'receiving_line')),
  sequence        integer not null,
  idempotency_key text not null,
  payload         jsonb not null,
  status          stock.offline_draft_status not null default 'queued',
  applied_ref     uuid,
  error           text,
  created_at      timestamptz not null default now(),
  synced_at       timestamptz,
  constraint offline_drafts_device_key_uniq unique (device_id, idempotency_key)
);
create index offline_drafts_pending_idx on stock.offline_drafts(device_id, sequence)
  where status = 'queued';

-- ---- Feature flags --------------------------------------

create table stock.feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into stock.feature_flags (key, enabled, config) values
  ('stock.enabled',         false, '{"note":"master pilot gate for the Stock system"}'),
  ('stock.offline_drafts',  true,  '{}'),
  ('stock.razorpay_live',   false, '{"note":"use live Razorpay keys instead of test"}'),
  ('stock.suggestions',     true,  '{}')
on conflict (key) do nothing;

-- ---- Reconciliation runs -------------------------------

create table stock.reconciliation_runs (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  kind           text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  discrepancies  integer not null default 0,
  report         jsonb not null default '{}'::jsonb
);
create index reconciliation_runs_org_idx on stock.reconciliation_runs(organization_id, started_at desc);

-- ---- Grants + RLS ------------------------------------

grant select, insert, update on stock.offline_drafts to stock_api;
grant select on stock.feature_flags to stock_api;
grant insert, update on stock.feature_flags to stock_api;
grant select, insert, update on stock.reconciliation_runs to stock_api;

alter table stock.offline_drafts       enable row level security;
alter table stock.feature_flags        enable row level security;
alter table stock.reconciliation_runs  enable row level security;

create policy offline_drafts_read on stock.offline_drafts for select to stock_api
  using (
    stock.is_system() or stock.is_central()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = offline_drafts.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );
create policy offline_drafts_write on stock.offline_drafts for all to stock_api
  using (
    stock.is_system() or stock.is_central()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = offline_drafts.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  )
  with check (
    stock.is_system() or stock.is_central()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = offline_drafts.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );

create policy feature_flags_read on stock.feature_flags for select to stock_api using (true);
create policy feature_flags_write on stock.feature_flags for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());

create policy reconciliation_runs_read on stock.reconciliation_runs for select to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_accountant());
create policy reconciliation_runs_write on stock.reconciliation_runs for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());
