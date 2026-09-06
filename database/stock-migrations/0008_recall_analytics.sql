-- Stock V1 S6 - Recall execution, demand-based reorder suggestions, daily
-- consumption rollups, explainable anomaly flags, and the projections the
-- combined Owner dashboard and Central oversight read.
-- docs/plans/stock-v1-build-plan.md "Returns and Recalls",
-- "Recommendations and Analytics"; Core Invariant 13.

-- ---- Recalls -----------------------------------------------

create type stock.recall_status as enum (
  'draft', 'active', 'locations_identified', 'quarantined', 'closed'
);

create table stock.recalls (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  item_id         uuid not null references stock.items(id) on delete restrict,
  batch_id        uuid not null references stock.batches(id) on delete restrict,
  reason          text not null,
  status          stock.recall_status not null default 'draft',
  activated_by    uuid,
  activated_at    timestamptz,
  closed_by       uuid,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint recalls_batch_uniq unique (batch_id)
);
create trigger recalls_set_updated_at before update on stock.recalls
  for each row execute function stock.set_updated_at();

create table stock.recall_locations (
  id                uuid primary key default gen_random_uuid(),
  recall_id         uuid not null references stock.recalls(id) on delete cascade,
  stock_location_id uuid not null references stock.stock_locations(id) on delete restrict,
  warehouse_id      uuid,
  outlet_id         uuid,
  qty_identified_base   numeric(20,6) not null default 0,
  qty_quarantined_base  numeric(20,6) not null default 0,
  qty_collected_base    numeric(20,6) not null default 0,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now(),
  constraint recall_locations_uniq unique (recall_id, stock_location_id)
);

-- ---- Daily consumption rollups --------------------------

create table stock.daily_consumption_rollups (
  organization_id  uuid not null,
  outlet_id        uuid not null,
  item_id          uuid not null references stock.items(id) on delete cascade,
  business_date    date not null,
  qty_consumed_base numeric(20,6) not null default 0,
  sale_lines       integer not null default 0,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, outlet_id, item_id, business_date)
);
create index daily_consumption_rollups_item_idx
  on stock.daily_consumption_rollups(outlet_id, item_id, business_date);

-- ---- Reorder suggestions ------------------------------
-- No manually configured min/max and never auto-ordering.

create type stock.suggestion_status as enum ('open', 'dismissed', 'converted');

create table stock.reorder_suggestions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  outlet_id        uuid not null,
  item_id          uuid not null references stock.items(id) on delete cascade,
  suggested_qty_base numeric(20,6) not null check (suggested_qty_base >= 0),
  inputs           jsonb not null default '{}'::jsonb,
  status           stock.suggestion_status not null default 'open',
  dismissed_until  date,
  converted_stock_order_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint reorder_suggestions_open_uniq unique (outlet_id, item_id)
);
create trigger reorder_suggestions_set_updated_at before update on stock.reorder_suggestions
  for each row execute function stock.set_updated_at();

-- ---- Explainable anomaly flags -----------------------
-- Review flags, never automatic accusations or penalties.

create table stock.anomaly_flags (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  outlet_id       uuid,
  warehouse_id    uuid,
  subject_type    text not null,
  subject_id      uuid,
  kind            text not null,
  explanation     jsonb not null default '{}'::jsonb,
  status          text not null default 'open' check (status in ('open','reviewed','dismissed')),
  reviewed_by     uuid,
  created_at      timestamptz not null default now()
);
create index anomaly_flags_open_idx on stock.anomaly_flags(organization_id) where status = 'open';

-- ---- Grants + RLS ------------------------------------

grant select, insert, update on
  stock.recalls, stock.recall_locations, stock.anomaly_flags
  to stock_api;
-- delete on these two is for projection rebuilds / stale-suggestion cleanup.
grant select, insert, update, delete on
  stock.daily_consumption_rollups, stock.reorder_suggestions
  to stock_api;

alter table stock.recalls                    enable row level security;
alter table stock.recall_locations           enable row level security;
alter table stock.daily_consumption_rollups  enable row level security;
alter table stock.reorder_suggestions        enable row level security;
alter table stock.anomaly_flags              enable row level security;

create policy recalls_read on stock.recalls for select to stock_api using (true);
create policy recalls_write on stock.recalls for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_warehouse_manager())
  with check (stock.is_system() or stock.is_central() or stock.is_warehouse_manager());

create policy recall_locations_read on stock.recall_locations for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_warehouse_manager()
    or (outlet_id is not null and outlet_id = stock.ctx_uuid('outlet_id'))
    or (warehouse_id is not null and stock.has_warehouse(warehouse_id))
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = recall_locations.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );
create policy recall_locations_write on stock.recall_locations for all to stock_api
  using (stock.is_system() or stock.is_central() or stock.is_warehouse_manager())
  with check (stock.is_system() or stock.is_central() or stock.is_warehouse_manager());

create policy rollups_read on stock.daily_consumption_rollups for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = daily_consumption_rollups.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );
create policy rollups_write on stock.daily_consumption_rollups for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());

create policy suggestions_read on stock.reorder_suggestions for select to stock_api
  using (
    stock.is_system() or stock.is_central()
    or outlet_id = stock.ctx_uuid('outlet_id')
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = reorder_suggestions.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );
create policy suggestions_write on stock.reorder_suggestions for all to stock_api
  using (
    stock.is_system() or stock.is_central()
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = reorder_suggestions.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  )
  with check (
    stock.is_system() or stock.is_central()
    or exists (select 1 from stock.outlet_stock_settings s
                where s.outlet_id = reorder_suggestions.outlet_id
                  and stock.is_owner_of(s.franchise_id))
  );

create policy anomaly_flags_read on stock.anomaly_flags for select to stock_api
  using (
    stock.is_system() or stock.is_central() or stock.is_accountant()
    or (outlet_id is not null and exists (
          select 1 from stock.outlet_stock_settings s
           where s.outlet_id = anomaly_flags.outlet_id and stock.is_owner_of(s.franchise_id)))
  );
create policy anomaly_flags_write on stock.anomaly_flags for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());
