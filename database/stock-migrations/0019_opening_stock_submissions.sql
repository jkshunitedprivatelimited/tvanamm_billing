-- Durable acknowledgement for a starting count, including zero-quantity lines.
create table stock.opening_stock_submissions (
  id uuid primary key,
  organization_id uuid not null,
  outlet_id uuid not null references stock.outlet_stock_settings(outlet_id),
  actor_account_id uuid,
  lines jsonb not null,
  created_at timestamptz not null default now()
);
alter table stock.opening_stock_submissions enable row level security;
grant select, insert on stock.opening_stock_submissions to stock_api;
create policy opening_stock_submissions_system on stock.opening_stock_submissions
  for all to stock_api using (stock.is_system()) with check (stock.is_system());
