-- Per-item starting point: sales before the first received/count stock are not deducted.
create table stock.item_tracking_starts (
  stock_location_id uuid not null references stock.stock_locations(id),
  item_id uuid not null references stock.items(id),
  started_at timestamptz not null default now(),
  primary key (stock_location_id, item_id)
);
alter table stock.item_tracking_starts enable row level security;
grant select, insert on stock.item_tracking_starts to stock_api;
create policy item_tracking_system on stock.item_tracking_starts for all to stock_api
  using (stock.is_system() or exists (select 1 from stock.stock_locations l where l.id = stock_location_id))
  with check (stock.is_system() or exists (select 1 from stock.stock_locations l where l.id = stock_location_id and (stock.is_central() or stock.is_owner_of(l.franchise_id) or stock.can_operate_warehouse(l.warehouse_id) or l.outlet_id = stock.ctx_uuid('outlet_id'))));
insert into stock.item_tracking_starts (stock_location_id,item_id,started_at)
select stock_location_id,item_id,min(occurred_at) from stock.stock_movements
where quantity > 0 group by stock_location_id,item_id;
alter table stock_inbox.events add column source_occurred_at timestamptz;
