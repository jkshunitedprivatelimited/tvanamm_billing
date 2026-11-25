-- Preparation only. Saving this document never books a courier or moves stock.
create table stock.shipment_preparations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stock_order_id uuid not null references stock.stock_orders(id),
  warehouse_id uuid not null references stock.warehouses(id),
  revision integer not null default 1,
  details jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique(stock_order_id,warehouse_id)
);
alter table stock.shipment_preparations enable row level security;
grant select,insert,update on stock.shipment_preparations to stock_api;
create policy shipment_preparations_system on stock.shipment_preparations for all to stock_api
  using(stock.is_system()) with check(stock.is_system());
