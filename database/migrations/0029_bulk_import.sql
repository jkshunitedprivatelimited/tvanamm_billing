-- Bulk import jobs (`docs/architecture/bulk-import-and-data-quality.md`).
-- The server accepts already-parsed, validated rows as JSON and processes
-- them synchronously in a bounded batch; client-side XLSX parsing, private
-- file storage, and async worker processing are deferred with the rest of
-- the background-job / object-storage infrastructure. The immutable job
-- record, per-row result, idempotent row keys, and audit are all here.

create type billing.import_job_kind as enum ('menu_item', 'expense_category');
create type billing.import_job_status as enum ('previewed', 'processing', 'completed', 'partial', 'failed');
create type billing.import_row_action as enum ('create', 'update', 'skip', 'error');

create table billing.import_jobs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references billing.organizations(id) on delete cascade,
  kind             billing.import_job_kind not null,
  template_version text not null,
  file_checksum    text,
  row_count        integer not null default 0,
  created_count    integer not null default 0,
  updated_count    integer not null default 0,
  skipped_count    integer not null default 0,
  error_count      integer not null default 0,
  status           billing.import_job_status not null default 'previewed',
  actor_account_id uuid references identity.account_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index import_jobs_org_idx on billing.import_jobs(organization_id, created_at desc);

create table billing.import_job_rows (
  id                uuid primary key default gen_random_uuid(),
  import_job_id     uuid not null references billing.import_jobs(id) on delete cascade,
  row_number        integer not null,
  business_key      text not null,
  action            billing.import_row_action not null,
  error             text,
  created_entity_id uuid,
  processed_at      timestamptz,
  constraint import_job_rows_uniq unique (import_job_id, row_number)
);
create index import_job_rows_job_idx on billing.import_job_rows(import_job_id);

insert into identity.capabilities (key, description) values
  ('billing.bulk_import', 'Preview and run Central bulk data imports')
on conflict (key) do nothing;
insert into identity.role_capabilities (role_key, capability_key) values
  ('central_admin', 'billing.bulk_import')
on conflict (role_key, capability_key) do nothing;

grant select, insert, update on billing.import_jobs, billing.import_job_rows to identity_api;

alter table billing.import_jobs      enable row level security;
alter table billing.import_job_rows  enable row level security;

create policy import_jobs_rw on billing.import_jobs for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());
create policy import_job_rows_rw on billing.import_job_rows for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());
