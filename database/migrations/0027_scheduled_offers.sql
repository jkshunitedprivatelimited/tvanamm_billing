-- Scheduled offers (`docs/architecture/scheduled-offers.md`) - time-windowed
-- item/combo discounts, distinct from an employee's manual discount. No
-- coupon codes, loyalty, segmentation, buy-X-get-Y, or usage limits in V1.

create type billing.offer_discount_kind as enum ('fixed', 'percent');
create type billing.offer_state         as enum ('draft', 'active', 'paused', 'expired');
create type billing.offer_target_type   as enum ('item', 'combo');

create table billing.offers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references billing.organizations(id) on delete restrict,
  brand_id        uuid not null references billing.brands(id) on delete restrict,
  owner_scope     billing.catalog_owner_scope not null,   -- 'master' = Central, 'outlet' = FO
  origin_outlet_id uuid references billing.outlets(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 160),
  label           text not null check (length(btrim(label)) between 1 and 80),  -- POS-facing
  discount_kind   billing.offer_discount_kind not null,
  discount_value  numeric(12,2) not null check (discount_value >= 0),
  priority        integer not null default 100,
  state           billing.offer_state not null default 'draft',
  starts_on       date not null,
  ends_on         date not null,
  days_of_week    smallint[],                    -- null = every day; 0=Sun .. 6=Sat
  start_time      time,                          -- null = all day
  end_time        time,
  version         integer not null default 1,
  created_by      uuid references identity.account_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint offers_scope_shape check (
    (owner_scope = 'master' and origin_outlet_id is null) or
    (owner_scope = 'outlet' and origin_outlet_id is not null)
  ),
  constraint offers_date_order check (ends_on >= starts_on),
  constraint offers_time_pair check ((start_time is null) = (end_time is null)),
  constraint offers_percent_range check (
    discount_kind <> 'percent' or discount_value <= 100
  )
);
create index offers_brand_state_idx on billing.offers(brand_id, state);
create index offers_origin_idx on billing.offers(origin_outlet_id) where owner_scope = 'outlet';
create trigger offers_set_updated_at before update on billing.offers
  for each row execute function identity.set_updated_at();

create table billing.offer_targets (
  offer_id    uuid not null references billing.offers(id) on delete cascade,
  target_type billing.offer_target_type not null,
  target_id   uuid not null,
  primary key (offer_id, target_type, target_id)
);

create table billing.offer_outlets (
  offer_id  uuid not null references billing.offers(id) on delete cascade,
  outlet_id uuid not null references billing.outlets(id) on delete cascade,
  primary key (offer_id, outlet_id)
);
create index offer_outlets_outlet_idx on billing.offer_outlets(outlet_id);

-- Snapshot of the offer that actually discounted a bill line, so a refund
-- uses the allocation as it stood at sale time, never current config.
alter table billing.bill_lines add column offer_id uuid;
alter table billing.bill_lines add column offer_label text;
alter table billing.bill_lines add column offer_discount numeric(12,2) not null default 0
  check (offer_discount >= 0);

-- ---- Capabilities ----------------------------------------------------

insert into identity.capabilities (key, description) values
  ('billing.offer.manage.master', 'Create and publish brand scheduled offers'),
  ('billing.offer.manage.franchise', 'Create and publish scheduled offers for owned outlets')
on conflict (key) do nothing;

insert into identity.role_capabilities (role_key, capability_key) values
  ('central_admin', 'billing.offer.manage.master'),
  ('franchise_owner', 'billing.offer.manage.franchise')
on conflict (role_key, capability_key) do nothing;

-- ---- Grants and RLS -----------------------------------------------------

grant select, insert, update, delete on
  billing.offers, billing.offer_targets, billing.offer_outlets to identity_api;

alter table billing.offers        enable row level security;
alter table billing.offer_targets enable row level security;
alter table billing.offer_outlets enable row level security;

-- offer_outlets / offer_targets policies are self-sufficient (they never
-- reference billing.offers) so billing.offers' policy can safely subquery
-- them without an RLS recursion cycle. Row visibility on billing.offers is
-- the real gate; the child tables inherit it structurally.
create policy offer_outlets_read on billing.offer_outlets for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or outlet_id in (select id from billing.outlets)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy offer_outlets_write on billing.offer_outlets for all to identity_api using (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
) with check (
  identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets)
);

create policy offer_targets_read on billing.offer_targets for select to identity_api using (true);
create policy offer_targets_write on billing.offer_targets for all to identity_api
  using (identity.is_system() or identity.is_central() or identity.ctx('role') = 'franchise_owner')
  with check (
    identity.is_system() or identity.is_central() or identity.ctx('role') = 'franchise_owner'
  );

create policy offers_read on billing.offers for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or (owner_scope = 'master')
  or identity.is_owner_of(
       (select o.franchise_id from billing.outlets o where o.id = origin_outlet_id))
  or origin_outlet_id = identity.ctx_uuid('outlet_id')
  or id in (select offer_id from billing.offer_outlets where outlet_id = identity.ctx_uuid('outlet_id'))
);
create policy offers_write on billing.offers for all to identity_api using (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and identity.is_owner_of(
       (select o.franchise_id from billing.outlets o where o.id = origin_outlet_id)))
) with check (
  identity.is_system() or identity.is_central()
  or (owner_scope = 'outlet' and identity.is_owner_of(
       (select o.franchise_id from billing.outlets o where o.id = origin_outlet_id)))
);
