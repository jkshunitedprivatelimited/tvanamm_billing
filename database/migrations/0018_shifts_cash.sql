-- Billing V1 Stage 2 - Employee shifts and the shared outlet cash session.
-- docs/plans/billing-data-api-plan.md §6 ; docs/architecture/billing-shifts.md
--
-- PIN login is operator tracking, not attendance: an employee explicitly starts
-- (or resumes) a shift before billing. Many employee shifts may be open at once,
-- but exactly ONE cash session is open per outlet. Closed shifts / sessions are
-- immutable and cannot be reopened. A Franchise Owner may force-close a
-- forgotten shift with a mandatory reason. Both must be closed before billing
-- resumes on the next business date.

create type billing.shift_status        as enum ('open', 'ended', 'force_closed');
create type billing.cash_session_status as enum ('open', 'closed', 'force_closed');

create table billing.cash_sessions (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references billing.organizations(id) on delete restrict,
  franchise_id          uuid references billing.franchises(id) on delete restrict,
  outlet_id             uuid not null references billing.outlets(id) on delete restrict,
  business_date         date not null,
  status                billing.cash_session_status not null default 'open',
  opened_by_employee_id uuid not null references identity.store_employees(id) on delete restrict,
  opened_by_name        text not null,
  opened_at             timestamptz not null default now(),
  opening_cash          numeric(12,2) not null check (opening_cash >= 0),
  closed_by_employee_id uuid references identity.store_employees(id) on delete restrict,
  closed_by_name        text,
  closed_at             timestamptz,
  counted_cash          numeric(12,2) check (counted_cash is null or counted_cash >= 0),
  expected_cash         numeric(12,2),
  variance              numeric(12,2),
  variance_reason       text,
  denominations         jsonb,
  force_close_reason    text,
  forced_by_account_id  uuid references identity.account_profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint cash_sessions_close_shape check (
    status = 'open'
    or (closed_by_employee_id is not null and closed_at is not null and counted_cash is not null)
  ),
  constraint cash_sessions_variance_reason check (
    coalesce(variance, 0) = 0 or variance_reason is not null or status = 'force_closed'
  )
);
create unique index cash_sessions_one_open_per_outlet
  on billing.cash_sessions(outlet_id) where status = 'open';
create index cash_sessions_outlet_date_idx on billing.cash_sessions(outlet_id, business_date desc);

create table billing.employee_shifts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references billing.organizations(id) on delete restrict,
  franchise_id          uuid references billing.franchises(id) on delete restrict,
  outlet_id             uuid not null references billing.outlets(id) on delete restrict,
  employee_id           uuid not null references identity.store_employees(id) on delete restrict,
  employee_name         text not null,
  terminal_id           uuid references identity.terminals(id) on delete set null,
  business_date         date not null,
  status                billing.shift_status not null default 'open',
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  ended_by_employee_id  uuid references identity.store_employees(id) on delete set null,
  force_close_reason    text,
  forced_by_account_id  uuid references identity.account_profiles(id) on delete set null,
  bill_count            integer not null default 0,
  created_at            timestamptz not null default now(),
  constraint employee_shifts_force_reason check (status <> 'force_closed' or force_close_reason is not null)
);
create unique index employee_shifts_one_open_per_employee
  on billing.employee_shifts(employee_id) where status = 'open';
create index employee_shifts_outlet_date_idx on billing.employee_shifts(outlet_id, business_date desc);
create index employee_shifts_employee_idx on billing.employee_shifts(employee_id, started_at desc);

-- A row may only change while it is still 'open' (so the closing UPDATE is the
-- last write). This makes closed / ended / force-closed records immutable.
create or replace function billing.reject_settled_row_update() returns trigger
  language plpgsql as $$
begin
  if old.status <> 'open' then
    raise exception '%.% row % is settled and cannot be modified',
      tg_table_schema, tg_table_name, old.id using errcode = '0A000';
  end if;
  return new;
end;
$$;
create trigger cash_sessions_no_reopen before update on billing.cash_sessions
  for each row execute function billing.reject_settled_row_update();
create trigger employee_shifts_no_reopen before update on billing.employee_shifts
  for each row execute function billing.reject_settled_row_update();

grant select, insert, update on billing.cash_sessions, billing.employee_shifts to identity_api;

alter table billing.cash_sessions   enable row level security;
alter table billing.employee_shifts enable row level security;

create policy cash_sessions_read on billing.cash_sessions for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy cash_sessions_write on billing.cash_sessions for all to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
) with check (
  identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);

create policy employee_shifts_read on billing.employee_shifts for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
create policy employee_shifts_write on billing.employee_shifts for all to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
) with check (
  identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
