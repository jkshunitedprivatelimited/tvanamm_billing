-- Billing V1 Stage 5 - bill history, reprinting, full/partial refunds.
-- docs/plans/billing-data-api-plan.md Phase 5-6 ;
-- docs/architecture/billing-history-refunds.md ; docs/architecture/receipt-printing.md
--
-- Completed bills are never edited/voided; corrections are a linked, immutable
-- refund. Refunds are online-only (no offline flag - the original bill must
-- already exist on the server). Partial refunds operate at bill-line
-- granularity: a line's final_total already bakes in its add-ons, so
-- refunding N of a line's units refunds that same per-unit share - true
-- per-add-on selective refund is deferred.

create type billing.refund_kind as enum ('full', 'partial');

create table billing.refunds (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references billing.organizations(id) on delete restrict,
  franchise_id      uuid references billing.franchises(id) on delete restrict,
  outlet_id         uuid not null references billing.outlets(id) on delete restrict,
  bill_id           uuid not null references billing.bills(id) on delete restrict,
  kind              billing.refund_kind not null,
  amount            numeric(12,2) not null check (amount > 0),
  payout_method     billing.bill_payment_method not null,
  payout_reference  text,
  reason            text not null check (length(btrim(reason)) > 0),
  actor_account_id  uuid references identity.account_profiles(id) on delete set null,
  actor_employee_id uuid references identity.store_employees(id) on delete set null,
  actor_name        text not null,
  cash_session_id   uuid references billing.cash_sessions(id) on delete set null,
  idempotency_key   text not null,
  correlation_id    uuid not null,
  created_at        timestamptz not null default now(),
  constraint refunds_outlet_idem_uniq unique (outlet_id, idempotency_key),
  constraint refunds_payout_reference_shape check (
    payout_method <> 'upi' or (payout_reference is not null and length(btrim(payout_reference)) > 0)
  ),
  constraint refunds_one_actor check (
    (actor_account_id is not null) <> (actor_employee_id is not null)
  )
);

create index refunds_bill_idx on billing.refunds(bill_id);
create index refunds_outlet_idx on billing.refunds(outlet_id, created_at desc);

create table billing.refund_lines (
  id            uuid primary key default gen_random_uuid(),
  refund_id     uuid not null references billing.refunds(id) on delete restrict,
  bill_line_id  uuid not null references billing.bill_lines(id) on delete restrict,
  quantity      integer not null check (quantity > 0),
  amount        numeric(12,2) not null check (amount >= 0)
);
create index refund_lines_refund_idx on billing.refund_lines(refund_id);
create index refund_lines_bill_line_idx on billing.refund_lines(bill_line_id);

-- Every reprint (and print) attempt, success or failure, permanently logged.
create table billing.print_attempts (
  id                uuid primary key default gen_random_uuid(),
  bill_id           uuid not null references billing.bills(id) on delete restrict,
  outlet_id         uuid not null references billing.outlets(id) on delete restrict,
  terminal_id       uuid references identity.terminals(id) on delete set null,
  actor_employee_id uuid references identity.store_employees(id) on delete set null,
  attempted_at      timestamptz not null default now(),
  result            text not null check (result in ('success', 'failed')),
  reason            text,
  is_reprint        boolean not null default false
);
create index print_attempts_bill_idx on billing.print_attempts(bill_id, attempted_at desc);

-- Append-only: refunds/refund_lines/print_attempts are a permanent log.
create trigger refunds_no_change before update or delete on billing.refunds
  for each row execute function identity.reject_mutation();
create trigger refund_lines_no_change before update or delete on billing.refund_lines
  for each row execute function identity.reject_mutation();
create trigger print_attempts_no_change before update or delete on billing.print_attempts
  for each row execute function identity.reject_mutation();

grant select, insert on billing.refunds, billing.refund_lines, billing.print_attempts to identity_api;

-- A refund locks the bill row with SELECT ... FOR UPDATE to serialize
-- concurrent refund attempts against it. Postgres requires both UPDATE
-- privilege AND a row security policy covering the UPDATE command for that
-- lock to succeed, even though no UPDATE statement is ever actually issued -
-- the unconditional reject_mutation trigger from migration 0019 still blocks
-- any real attempt to modify a bill (the policy's own WITH CHECK (false)
-- blocks it too), so none of this weakens immutability.
grant update on billing.bills to identity_api;
create policy bills_lock_for_refund on billing.bills for update to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
) with check (false);

alter table billing.refunds        enable row level security;
alter table billing.refund_lines   enable row level security;
alter table billing.print_attempts enable row level security;

create policy refunds_read on billing.refunds for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy refunds_insert on billing.refunds for insert to identity_api with check (
  outlet_id = identity.ctx_uuid('outlet_id') or identity.is_owner_of(franchise_id)
);
create policy refund_lines_read on billing.refund_lines for select to identity_api
  using (refund_id in (select id from billing.refunds));
create policy refund_lines_insert on billing.refund_lines for insert to identity_api
  with check (refund_id in (select id from billing.refunds));

create policy print_attempts_read on billing.print_attempts for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy print_attempts_insert on billing.print_attempts for insert to identity_api
  with check (identity.is_system() or outlet_id = identity.ctx_uuid('outlet_id'));
