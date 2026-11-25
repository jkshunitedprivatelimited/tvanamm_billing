-- Prepared-base posting at the outlet.
--
-- Sale consumption already draws from stock.prepared_batches (0007) instead of
-- the raw recipe when a prepared base covers the line. This adds the missing
-- writer: an outlet records "made N of <intermediate recipe>", which issues the
-- scaled raw inputs once (production_input), receives the prepared item
-- (production_output) and opens a prepared batch. Leftover base can be
-- discarded so later sales stop drawing from it.
--
-- Retries are keyed by a client submission id; a repeated submission returns the
-- original batch instead of issuing inputs again.

alter table stock.prepared_batches
  add column if not exists recipe_id uuid references stock.recipes(id) on delete restrict,
  add column if not exists recipe_version integer,
  add column if not exists submission_id uuid,
  add column if not exists recorded_by_employee uuid,
  add column if not exists discarded_qty_base numeric(20,6) not null default 0
    check (discarded_qty_base >= 0);

create unique index if not exists prepared_batches_submission_uniq
  on stock.prepared_batches(organization_id, submission_id)
  where submission_id is not null;
create index if not exists prepared_batches_outlet_idx
  on stock.prepared_batches(outlet_id, recorded_at desc);

create table if not exists stock.prepared_batch_inputs (
  id                 uuid primary key default gen_random_uuid(),
  prepared_batch_id  uuid not null references stock.prepared_batches(id) on delete cascade,
  item_id            uuid not null references stock.items(id) on delete restrict,
  qty_base           numeric(20,6) not null check (qty_base > 0),
  shortfall_base     numeric(20,6) not null default 0 check (shortfall_base >= 0),
  skipped_untracked  boolean not null default false
);
create index if not exists prepared_batch_inputs_batch_idx
  on stock.prepared_batch_inputs(prepared_batch_id);

create table if not exists stock.prepared_batch_discards (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  prepared_batch_id uuid not null references stock.prepared_batches(id) on delete cascade,
  submission_id     uuid not null,
  qty_base          numeric(20,6) not null check (qty_base > 0),
  reason            text not null check (length(btrim(reason)) between 1 and 500),
  recorded_by       uuid,
  recorded_by_employee uuid,
  recorded_at       timestamptz not null default now(),
  constraint prepared_batch_discards_submission_uniq unique (organization_id, submission_id)
);

alter table stock.prepared_batch_inputs   enable row level security;
alter table stock.prepared_batch_discards enable row level security;

-- Service code writes these under the system context after its own outlet checks.
create policy prepared_batch_inputs_rw on stock.prepared_batch_inputs for all to stock_api
  using (stock.is_central() or stock.is_system())
  with check (stock.is_central() or stock.is_system());
create policy prepared_batch_discards_rw on stock.prepared_batch_discards for all to stock_api
  using (stock.is_central() or stock.is_system())
  with check (stock.is_central() or stock.is_system());

grant select, insert on stock.prepared_batch_inputs, stock.prepared_batch_discards to stock_api;

insert into stock.capabilities (code, description) values
  ('stock.preparation.record', 'Record prepared bases made at an outlet and discard leftovers')
on conflict (code) do nothing;
insert into stock.role_capabilities (role, capability) values
  ('central_admin', 'stock.preparation.record'),
  ('franchise_owner', 'stock.preparation.record'),
  ('store_employee', 'stock.preparation.record')
on conflict do nothing;
