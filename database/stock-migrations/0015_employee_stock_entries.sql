-- Durable employee requests: stock + billing expense can recover across separate databases.
create table stock.employee_stock_entries (
 id uuid primary key,
 organization_id uuid not null,
 outlet_id uuid not null,
 employee_id uuid not null,
 employee_name text not null,
 command jsonb not null,
 result jsonb,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
alter table stock.employee_stock_entries enable row level security;
grant select, insert, update on stock.employee_stock_entries to stock_api;
create policy employee_stock_entries_system on stock.employee_stock_entries to stock_api
 using (current_setting('app.request',true) = 'system')
 with check (current_setting('app.request',true) = 'system');
create index employee_stock_entries_outlet on stock.employee_stock_entries(outlet_id, created_at desc);
create policy employee_stock_entries_read on stock.employee_stock_entries for select to stock_api using (
 organization_id=stock.ctx_uuid('organization_id') and (
 stock.is_central() or
 (employee_id=stock.ctx_uuid('operator_employee_id') and outlet_id=stock.ctx_uuid('outlet_id')) or
 exists(select 1 from stock.outlet_stock_settings s where s.outlet_id=employee_stock_entries.outlet_id and stock.is_owner_of(s.franchise_id))
 ));
