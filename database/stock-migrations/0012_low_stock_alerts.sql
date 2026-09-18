-- Per-outlet limits in each item's base unit. No arbitrary default limit.
create table stock.low_stock_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  franchise_id uuid,
  outlet_id uuid not null references stock.outlet_stock_settings(outlet_id),
  item_id uuid not null,
  threshold_base numeric(20,6) not null check (threshold_base >= 0),
  enabled boolean not null default true,
  episode_id uuid,
  last_quantity numeric(20,6),
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(outlet_id, item_id),
  foreign key(item_id, organization_id) references stock.items(id, organization_id)
);
create index low_stock_rules_scan on stock.low_stock_rules(checked_at nulls first, id);
alter table stock.low_stock_rules enable row level security;
alter table stock.low_stock_rules force row level security;
grant select, insert, update on stock.low_stock_rules to stock_api;
create policy low_stock_rules_access on stock.low_stock_rules for all to stock_api
using (stock.is_system() or (organization_id = stock.ctx_uuid('organization_id')
  and (stock.is_central() or stock.is_owner_of(franchise_id))))
with check (stock.is_system() or (organization_id = stock.ctx_uuid('organization_id')
  and (stock.is_central() or stock.is_owner_of(franchise_id))));

-- Durable notification outbox. Changes and events commit together; delivery
-- into Identity is retried independently of billing and stock transactions.
create table stock.low_stock_events (
  id bigint generated always as identity primary key,
  rule_id uuid not null references stock.low_stock_rules(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index low_stock_events_pending on stock.low_stock_events(id) where delivered_at is null;
alter table stock.low_stock_events enable row level security;
alter table stock.low_stock_events force row level security;
grant select, insert, update on stock.low_stock_events to stock_api;
grant usage, select on sequence stock.low_stock_events_id_seq to stock_api;
create policy low_stock_events_system on stock.low_stock_events for all to stock_api
using (stock.is_system()) with check (stock.is_system());
