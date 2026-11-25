-- Additive Stock-only scheduling; Billing checkout/schema are unchanged.
alter table stock_inbox.events
  add column next_attempt_at timestamptz not null default now();
create index stock_inbox_retry_due_idx on stock_inbox.events(next_attempt_at, received_at)
  where processed_at is null and dead_lettered_at is null;
