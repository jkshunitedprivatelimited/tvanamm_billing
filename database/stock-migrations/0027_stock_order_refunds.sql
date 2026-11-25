-- Cancelling stock orders and refunding prepaid ones.
--
-- An unpaid order can be cancelled outright. A paid order can be cancelled by
-- Central before any stock is allocated to it; its captured Razorpay payment is
-- then refunded. The refund row is written before Razorpay is called and carries
-- our own id in the refund notes, so a retry after a crash or timeout finds the
-- refund Razorpay already created instead of refunding twice. Razorpay's
-- refund.processed / refund.failed webhooks settle the final status.

alter table stock.stock_orders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

create table if not exists stock.stock_order_refunds (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  stock_order_id      uuid not null references stock.stock_orders(id) on delete restrict,
  submission_id       uuid not null,
  razorpay_payment_id text not null,
  razorpay_refund_id  text,
  amount_paise        bigint not null check (amount_paise > 0),
  currency            text not null default 'INR',
  reason              text not null check (length(btrim(reason)) between 1 and 500),
  status              text not null default 'requested'
    check (status in ('requested', 'pending', 'processed', 'failed')),
  failure_note        text,
  requested_by        uuid,
  requested_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint stock_order_refunds_submission_uniq unique (organization_id, submission_id),
  constraint stock_order_refunds_rzp_uniq unique (razorpay_refund_id)
);
-- At most one live (not failed) refund per order: a failed one may be retried.
create unique index if not exists stock_order_refunds_one_live
  on stock.stock_order_refunds(stock_order_id) where status <> 'failed';
create trigger stock_order_refunds_set_updated_at before update on stock.stock_order_refunds
  for each row execute function stock.set_updated_at();
create trigger stock_order_refunds_no_delete before delete on stock.stock_order_refunds
  for each row execute function stock.reject_mutation();

alter table stock.stock_order_refunds enable row level security;
grant select, insert, update on stock.stock_order_refunds to stock_api;
create policy stock_order_refunds_rw on stock.stock_order_refunds for all to stock_api
  using (stock.is_system() or stock.is_central())
  with check (stock.is_system() or stock.is_central());
