create table stock.worker_status (
  worker text not null check (worker in ('events', 'alerts')),
  organization_id uuid not null,
  run_id uuid not null,
  state text not null check (state in ('running','completed','paused','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_success_at timestamptz,
  primary key(worker,organization_id)
);
alter table stock.worker_status enable row level security;
grant select,insert,update on stock.worker_status to stock_api;
create policy worker_status_system on stock.worker_status for all to stock_api
  using (stock.is_system()) with check (stock.is_system());
