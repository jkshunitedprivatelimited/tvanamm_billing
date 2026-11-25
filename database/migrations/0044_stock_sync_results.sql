-- Stock's processing result for each Billing sale/refund event.
--
-- Billing writes SaleCompleted / SaleRefunded to outbox.events; the event worker
-- delivers them to Stock, which consumes materials and emits
-- SaleConsumptionProcessed / SaleConsumptionFailed through its own outbox. The
-- result consumer (@jksh/stock consumeStockResults) records one row here per
-- source event and acknowledges the Stock outbox row, so Billing can show and
-- reconcile whether every bill reached Stock — without the two databases ever
-- sharing a transaction.
--
-- Written only by the worker's direct connection; API roles get no access.

create table if not exists billing.stock_sync_results (
  source_event_id     uuid primary key,          -- Billing outbox.events.id
  stock_outbox_id     uuid not null unique,      -- Stock stock_outbox.events.id
  event_type          text not null check (event_type in ('SaleCompleted', 'SaleRefunded')),
  bill_id             uuid,
  refund_id           uuid,
  outlet_id           uuid,
  status              text not null
    check (status in ('processed', 'negative_exception', 'refund_noop', 'failed')),
  negative_exceptions integer not null default 0 check (negative_exceptions >= 0),
  processed_at        timestamptz not null,
  recorded_at         timestamptz not null default now()
);
create index if not exists stock_sync_results_outlet_idx
  on billing.stock_sync_results(outlet_id, processed_at desc);
create index if not exists stock_sync_results_bill_idx
  on billing.stock_sync_results(bill_id);

alter table billing.stock_sync_results enable row level security;
revoke all on billing.stock_sync_results from public;
