alter table stock.low_stock_events
  add column attempts integer not null default 0,
  add column next_attempt_at timestamptz not null default now(),
  add column dead_lettered_at timestamptz,
  add column last_error text;
create index low_stock_events_retry_idx on stock.low_stock_events(next_attempt_at, id)
  where delivered_at is null and dead_lettered_at is null;
