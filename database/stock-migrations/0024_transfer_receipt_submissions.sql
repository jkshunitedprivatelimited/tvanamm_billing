create table stock.transfer_receipt_submissions (
  transfer_id uuid not null references stock.stock_transfers(id),
  submission_id text not null,
  payload jsonb not null,
  status text not null,
  created_at timestamptz not null default now(),
  primary key(transfer_id,submission_id)
);
alter table stock.transfer_receipt_submissions enable row level security;
grant select,insert on stock.transfer_receipt_submissions to stock_api;
create policy transfer_receipts_system on stock.transfer_receipt_submissions for all to stock_api
  using(stock.is_system()) with check(stock.is_system());
