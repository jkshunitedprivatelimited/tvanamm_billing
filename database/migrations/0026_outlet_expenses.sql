-- Outlet operational expenses (`docs/architecture/outlet-expenses.md`) -
-- local material/cleaning/repair/transport/petty spend for owner visibility
-- and Cash reconciliation. Not accounting, payroll, tax, or AP.

create type billing.expense_payment_source as enum
  ('shared_cash_drawer', 'outlet_upi', 'owner_paid', 'employee_paid');

-- Central maintains standard categories (brand_id null = every brand in the org).
create table billing.expense_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references billing.organizations(id) on delete restrict,
  brand_id        uuid references billing.brands(id) on delete cascade,
  name            text not null check (length(btrim(name)) between 1 and 120),
  is_active       boolean not null default true,
  created_by      uuid references identity.account_profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index expense_categories_org_idx on billing.expense_categories(organization_id);
create unique index expense_categories_uniq on billing.expense_categories
  (organization_id, coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- One org-level default high-value alert threshold; an owner may set a
-- stricter per-outlet override (see billing.outlet_expense_settings).
create table billing.expense_config (
  organization_id             uuid primary key references billing.organizations(id) on delete cascade,
  default_high_value_threshold numeric(12,2) not null default 5000 check (default_high_value_threshold >= 0),
  updated_by                  uuid references identity.account_profiles(id) on delete set null,
  updated_at                  timestamptz not null default now()
);
create table billing.outlet_expense_settings (
  outlet_id             uuid primary key references billing.outlets(id) on delete cascade,
  high_value_threshold  numeric(12,2) check (high_value_threshold is null or high_value_threshold >= 0),
  updated_by            uuid references identity.account_profiles(id) on delete set null,
  updated_at            timestamptz not null default now()
);

-- An expense is immutable once recorded; only the review and reversal
-- columns may be filled in later (owner review, owner reversal) - the same
-- controlled-mutation-exception pattern as attendance_sessions.checked_out_at.
create table billing.outlet_expenses (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references billing.organizations(id) on delete restrict,
  franchise_id             uuid references billing.franchises(id) on delete restrict,
  outlet_id                uuid not null references billing.outlets(id) on delete restrict,
  category_id              uuid references billing.expense_categories(id) on delete set null,
  category_name            text not null,
  amount                   numeric(12,2) not null check (amount > 0),
  payment_source           billing.expense_payment_source not null,
  reason                   text not null check (length(btrim(reason)) between 1 and 500),
  receipt_url              text,
  recorded_by_employee_id  uuid references identity.store_employees(id) on delete set null,
  recorded_by_account_id   uuid references identity.account_profiles(id) on delete set null,
  business_date            date not null,
  cash_session_id          uuid references billing.cash_sessions(id) on delete set null,
  reviewed_at              timestamptz,
  reviewed_by_account_id   uuid references identity.account_profiles(id) on delete set null,
  reversed_at              timestamptz,
  reversed_by_account_id   uuid references identity.account_profiles(id) on delete set null,
  reversal_reason          text check (reversal_reason is null or length(btrim(reversal_reason)) between 1 and 500),
  idempotency_key          text,
  created_at               timestamptz not null default now(),
  constraint outlet_expenses_one_recorder check (
    (recorded_by_employee_id is not null) <> (recorded_by_account_id is not null)
  ),
  constraint outlet_expenses_reversal_shape check (
    (reversed_at is null) = (reversal_reason is null)
  ),
  constraint outlet_expenses_idem_uniq unique (outlet_id, idempotency_key)
);
create index outlet_expenses_outlet_date_idx
  on billing.outlet_expenses(outlet_id, business_date desc);
create index outlet_expenses_cash_session_idx
  on billing.outlet_expenses(cash_session_id) where cash_session_id is not null;
create index outlet_expenses_unreviewed_idx
  on billing.outlet_expenses(outlet_id) where reviewed_at is null and reversed_at is null;

-- ---- Capabilities ----------------------------------------------------

insert into identity.capabilities (key, description) values
  ('billing.expense.record', 'Record an outlet operational expense'),
  ('billing.expense.oversee', 'Review, reverse, and report on outlet expenses'),
  ('billing.expense.config', 'Manage standard expense categories and alert thresholds'),
  ('billing.expense.read', 'View expense and reconciliation reports without editing')
on conflict (key) do nothing;

insert into identity.role_capabilities (role_key, capability_key) values
  ('franchise_owner', 'billing.expense.record'),
  ('franchise_owner', 'billing.expense.oversee'),
  ('franchise_owner', 'billing.expense.read'),
  ('central_admin', 'billing.expense.oversee'),
  ('central_admin', 'billing.expense.config'),
  ('central_admin', 'billing.expense.read'),
  ('accountant', 'billing.expense.read')
on conflict (role_key, capability_key) do nothing;

-- ---- Grants and RLS -----------------------------------------------------

grant select, insert, update on
  billing.expense_categories, billing.expense_config, billing.outlet_expense_settings
  to identity_api;
grant select, insert, update on billing.outlet_expenses to identity_api;

alter table billing.expense_categories       enable row level security;
alter table billing.expense_config           enable row level security;
alter table billing.outlet_expense_settings  enable row level security;
alter table billing.outlet_expenses          enable row level security;

create policy expense_categories_read on billing.expense_categories for select to identity_api
  using (true);
create policy expense_categories_write on billing.expense_categories for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());

create policy expense_config_read on billing.expense_config for select to identity_api using (true);
create policy expense_config_write on billing.expense_config for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());

create policy outlet_expense_settings_read on billing.outlet_expense_settings for select to identity_api
  using (
    identity.is_system() or identity.is_central() or identity.is_accountant()
    or outlet_id in (select id from billing.outlets)
  );
create policy outlet_expense_settings_write on billing.outlet_expense_settings for all to identity_api
  using (identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets))
  with check (identity.is_system() or identity.is_central() or outlet_id in (select id from billing.outlets));

-- Read: Central/Accountant everything; Franchise Owner owned outlets; an
-- operator only their own outlet's expenses (to render the running list).
create policy outlet_expenses_read on billing.outlet_expenses for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
-- Write: an operator may only insert their own expense at their outlet; a
-- Franchise Owner / Central may insert or update (review/reverse) for
-- outlets in scope.
create policy outlet_expenses_write on billing.outlet_expenses for all to identity_api using (
  identity.is_system() or identity.is_central()
  or identity.is_owner_of(franchise_id)
  or (outlet_id = identity.ctx_uuid('outlet_id')
      and recorded_by_employee_id = identity.ctx_uuid('operator_employee_id'))
) with check (
  identity.is_system() or identity.is_central()
  or identity.is_owner_of(franchise_id)
  or (outlet_id = identity.ctx_uuid('outlet_id')
      and recorded_by_employee_id = identity.ctx_uuid('operator_employee_id'))
);
