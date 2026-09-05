-- Billing V1 Stage 4A - offline billing backend contract.
-- docs/plans/billing-data-api-plan.md Phase 4 ; docs/architecture/offline-billing.md
--
-- Server-side pieces only: the signed 24h offline-authorization bundle is a
-- stateless HMAC token (packages/identity/src/offline-auth.ts, no table needed
-- for it), receipt-number BLOCK reservation and voiding, and a per-terminal
-- sync-batch rate limit. The PWA client (service worker, IndexedDB, sync UI)
-- is a separate follow-up.

-- ---- 1. Fix: receipt sequence continuity across terminal replacement -----
-- 0019 keyed the per-day counter by terminal_id. But the MVP allows only one
-- active terminal per outlet, and a REPLACED terminal reissues the SAME
-- receipt prefix (identity.terminals_outlet_prefix_active). Keying by
-- terminal_id let a replacement's counter restart at 1 and re-offer numbers
-- the old device already printed that day. Key by (outlet, prefix, date)
-- instead, so the sequence continues regardless of which physical terminal
-- currently holds that prefix ("Reinstall/re-enrollment cannot reuse
-- unconfirmed receipt-number allocations").

drop table billing.receipt_sequences;

create table billing.receipt_sequences (
  outlet_id        uuid not null references billing.outlets(id) on delete restrict,
  prefix           text not null,
  business_date    date not null,
  last_seq         integer not null default 0,
  last_terminal_id uuid references identity.terminals(id) on delete set null,
  primary key (outlet_id, prefix, business_date)
);

grant select, insert, update on billing.receipt_sequences to identity_api;

alter table billing.receipt_sequences enable row level security;
create policy receipt_sequences_rw on billing.receipt_sequences for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
) with check (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
);

-- ---- 2. Receipt-number block reservations --------------------------------
-- A terminal reserves a block while online, to spend while disconnected.
-- Numbers are never reused: the counter above only moves forward, and any
-- part of a block left unused past its expiry is explicitly voided (recorded,
-- not silently reassigned) rather than handed to a later reservation.

create table billing.receipt_reservations (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references billing.outlets(id) on delete restrict,
  terminal_id    uuid not null references identity.terminals(id) on delete restrict,
  prefix         text not null,
  business_date  date not null,
  start_seq      integer not null check (start_seq > 0),
  end_seq        integer not null check (end_seq >= start_seq),
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  status         text not null default 'active' check (status in ('active', 'consumed', 'voided')),
  voided_at      timestamptz
);
create index receipt_reservations_lookup_idx
  on billing.receipt_reservations(outlet_id, prefix, business_date, start_seq, end_seq);
create index receipt_reservations_expiry_idx
  on billing.receipt_reservations(expires_at) where status = 'active';

create table billing.receipt_number_voids (
  id              uuid primary key default gen_random_uuid(),
  outlet_id       uuid not null references billing.outlets(id) on delete restrict,
  reservation_id  uuid references billing.receipt_reservations(id) on delete set null,
  receipt_number  text not null,
  voided_at       timestamptz not null default now(),
  reason          text not null default 'reservation_expired_unused',
  constraint receipt_number_voids_uniq unique (outlet_id, receipt_number)
);

grant select, insert, update on billing.receipt_reservations to identity_api;
grant select, insert on billing.receipt_number_voids to identity_api;

alter table billing.receipt_reservations enable row level security;
alter table billing.receipt_number_voids enable row level security;

create policy receipt_reservations_rw on billing.receipt_reservations for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
) with check (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy receipt_number_voids_rw on billing.receipt_number_voids for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
) with check (
  identity.is_system() or identity.is_central() or outlet_id = identity.ctx_uuid('outlet_id')
);

-- Voided/consumed reservations and void records are a permanent log: a
-- reservation may only be updated while still 'active' (the transition to
-- 'consumed' / 'voided' is its last write).
create or replace function billing.reject_finalized_reservation_update() returns trigger
  language plpgsql as $$
begin
  if old.status <> 'active' then
    raise exception 'billing.receipt_reservations row % is finalized and cannot be modified', old.id
      using errcode = '0A000';
  end if;
  return new;
end;
$$;
create trigger receipt_reservations_no_reopen before update on billing.receipt_reservations
  for each row execute function billing.reject_finalized_reservation_update();
create trigger receipt_number_voids_no_change before update or delete on billing.receipt_number_voids
  for each row execute function identity.reject_mutation();

-- ---- 3. Sync-batch rate limit ---------------------------------------------
-- Throttles the offline-authorization and batch-sync endpoints per terminal,
-- independent of (and in addition to) the per-bill idempotency key.

create table identity.sync_attempts (
  terminal_id        uuid primary key references identity.terminals(id) on delete cascade,
  window_started_at  timestamptz not null default now(),
  request_count      integer not null default 0
);

grant select, insert, update on identity.sync_attempts to identity_api;

alter table identity.sync_attempts enable row level security;
create policy sync_attempts_rw on identity.sync_attempts for all to identity_api
  using (identity.is_system()) with check (identity.is_system());
