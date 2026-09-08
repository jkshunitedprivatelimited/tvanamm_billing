-- A verifiable log of every bill export run. Bills stay in the active store
-- but each export (owner-requested or the canonical day-60 run) records what
-- range and how many rows it covered, plus a content checksum, so it can be
-- proven that the older records were exported before any future archive/purge.

create table billing.retention_exports (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  franchise_id      uuid,
  outlet_id         uuid,
  from_date         date not null,
  to_date           date not null,
  kind              text not null default 'owner_export'
                      check (kind in ('owner_export', 'canonical_day60')),
  bill_count        integer not null default 0,
  line_count        integer not null default 0,
  payment_count     integer not null default 0,
  refund_count      integer not null default 0,
  checksum          text not null,
  actor_account_id  uuid,
  created_at        timestamptz not null default now(),
  constraint retention_exports_range check (from_date <= to_date)
);
create index retention_exports_org_idx
  on billing.retention_exports(organization_id, created_at desc);
create index retention_exports_franchise_idx
  on billing.retention_exports(franchise_id, created_at desc);

-- Append-only.
create trigger retention_exports_no_change before update or delete
  on billing.retention_exports
  for each row execute function identity.reject_mutation();

alter table billing.retention_exports enable row level security;

create policy retention_exports_read on billing.retention_exports for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
);
create policy retention_exports_insert on billing.retention_exports for insert to identity_api
  with check (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));
