-- Owner supplies details; only central can create and activate the outlet.
create table identity.outlet_onboarding (
  franchise_id uuid primary key references billing.franchises(id),
  details jsonb not null,
  submitted_by uuid not null references identity.account_profiles(id),
  submitted_at timestamptz not null default now(),
  outlet_id uuid references billing.outlets(id),
  reviewed_by uuid references identity.account_profiles(id),
  reviewed_at timestamptz
);
grant select, insert, update on identity.outlet_onboarding to identity_api;
alter table identity.outlet_onboarding enable row level security;
create policy onboarding_read on identity.outlet_onboarding for select to identity_api
  using (identity.is_central() or identity.is_owner_of(franchise_id));
create policy onboarding_insert on identity.outlet_onboarding for insert to identity_api
  with check (identity.is_owner_of(franchise_id) and submitted_by = identity.ctx_uuid('account_id')
    and outlet_id is null and reviewed_by is null and reviewed_at is null);
create policy onboarding_update on identity.outlet_onboarding for update to identity_api
  using (identity.is_central());
