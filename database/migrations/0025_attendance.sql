-- Workforce attendance (`docs/architecture/workforce-attendance.md`) - a
-- lightweight check-in/check-out record, deliberately separate from PIN
-- login, Billing shifts, and Cash sessions ("One action never silently
-- creates, closes, or edits another record"). Not payroll/HRMS.

create type identity.attendance_status as enum ('open', 'closed', 'missing_checkout');

create table identity.attendance_sessions (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references billing.organizations(id) on delete restrict,
  franchise_id           uuid references billing.franchises(id) on delete restrict,
  outlet_id              uuid not null references billing.outlets(id) on delete restrict,
  employee_id            uuid not null references identity.store_employees(id) on delete restrict,
  employee_name          text not null,
  terminal_id            uuid references identity.terminals(id) on delete set null,
  business_date          date not null,
  checked_in_at          timestamptz not null default now(),
  checked_in_device_time timestamptz,
  checked_out_at         timestamptz,
  checked_out_device_time timestamptz,
  status                 identity.attendance_status not null default 'open',
  created_at             timestamptz not null default now()
);
create unique index attendance_one_open_per_employee
  on identity.attendance_sessions(employee_id) where status = 'open';
create index attendance_outlet_date_idx
  on identity.attendance_sessions(outlet_id, business_date desc);
create index attendance_employee_date_idx
  on identity.attendance_sessions(employee_id, business_date desc);

-- Append-only. The original session row is never overwritten by a
-- correction - "The original stays immutable and the correction is linked"
-- - only checked_out_at may be filled in by the checkout command itself
-- (not a correction), so a session that never checked out is provable later.
create table identity.attendance_corrections (
  id                     uuid primary key default gen_random_uuid(),
  attendance_session_id  uuid not null references identity.attendance_sessions(id) on delete cascade,
  corrected_checked_in_at timestamptz,
  corrected_checked_out_at timestamptz,
  reason                 text not null check (length(btrim(reason)) between 1 and 500),
  corrected_by_account_id uuid references identity.account_profiles(id) on delete set null,
  corrected_at           timestamptz not null default now()
);
create index attendance_corrections_session_idx
  on identity.attendance_corrections(attendance_session_id, corrected_at desc);
create trigger attendance_corrections_no_update before update on identity.attendance_corrections
  for each row execute function identity.reject_mutation();
create trigger attendance_corrections_no_delete before delete on identity.attendance_corrections
  for each row execute function identity.reject_mutation();

-- Optional expected start/end + grace period, outlet-wide (no per-employee
-- override in this pass - "Schedules are optional"). Central configures.
create table identity.outlet_schedules (
  outlet_id            uuid primary key references billing.outlets(id) on delete cascade,
  expected_start_time   time not null,
  expected_end_time     time not null,
  grace_minutes         integer not null default 10 check (grace_minutes >= 0),
  updated_by            uuid references identity.account_profiles(id) on delete set null,
  updated_at            timestamptz not null default now()
);
create trigger outlet_schedules_set_updated_at before update on identity.outlet_schedules
  for each row execute function identity.set_updated_at();

-- ---- Capabilities ----------------------------------------------------

insert into identity.capabilities (key, description) values
  ('identity.attendance.self', 'Check in/out for yourself and view your own recent attendance'),
  ('identity.attendance.oversee', 'View, export, and correct outlet attendance'),
  ('identity.attendance.schedule_manage', 'Configure an outlet''s expected attendance schedule')
on conflict (key) do nothing;

insert into identity.role_capabilities (role_key, capability_key) values
  ('franchise_owner', 'identity.attendance.oversee'),
  ('central_admin', 'identity.attendance.oversee'),
  ('central_admin', 'identity.attendance.schedule_manage')
on conflict (role_key, capability_key) do nothing;

-- ---- Grants and RLS -----------------------------------------------------

grant select, insert, update on identity.attendance_sessions to identity_api;
grant select, insert on identity.attendance_corrections to identity_api;
grant select, insert, update on identity.outlet_schedules to identity_api;

alter table identity.attendance_sessions enable row level security;
alter table identity.attendance_corrections enable row level security;
alter table identity.outlet_schedules enable row level security;

-- Read: Central/Accountant see everything; a Franchise Owner sees owned
-- outlets; an operator sees only their own outlet's sessions (needed to
-- resolve "is there already an open session for me").
create policy attendance_read on identity.attendance_sessions for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or identity.is_owner_of(franchise_id)
  or outlet_id = identity.ctx_uuid('outlet_id')
);
-- Write: an operator may only insert/update their own row (checkin/checkout);
-- a Franchise Owner never directly writes a session row (corrections go
-- through attendance_corrections instead).
create policy attendance_write on identity.attendance_sessions for all to identity_api using (
  identity.is_system()
  or (outlet_id = identity.ctx_uuid('outlet_id') and employee_id = identity.ctx_uuid('operator_employee_id'))
) with check (
  identity.is_system()
  or (outlet_id = identity.ctx_uuid('outlet_id') and employee_id = identity.ctx_uuid('operator_employee_id'))
);

create policy attendance_corrections_read on identity.attendance_corrections for select to identity_api using (
  attendance_session_id in (select id from identity.attendance_sessions)
);
create policy attendance_corrections_write on identity.attendance_corrections for insert to identity_api
  with check (
    identity.is_system() or identity.is_central()
    or exists (
      select 1 from identity.attendance_sessions s
       where s.id = attendance_session_id and identity.is_owner_of(s.franchise_id)
    )
  );

create policy outlet_schedules_read on identity.outlet_schedules for select to identity_api using (
  identity.is_system() or identity.is_central() or identity.is_accountant()
  or outlet_id in (select id from billing.outlets)
);
create policy outlet_schedules_write on identity.outlet_schedules for all to identity_api using (
  identity.is_system() or identity.is_central()
) with check (
  identity.is_system() or identity.is_central()
);
