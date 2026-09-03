-- Stage 1 audit remediation (P1) - terminal-wide PIN brute-force protection.
-- A PIN with no matching employee must still increment a terminal-level counter,
-- so a stolen terminal credential cannot enumerate the 10,000-value PIN space.

create table identity.terminal_pin_attempts (
  terminal_id       uuid primary key references identity.terminals(id) on delete cascade,
  failed_count      integer not null default 0,
  last_failed_at    timestamptz,
  lock_time         timestamptz,
  window_started_at timestamptz not null default now()
);

grant select, insert, update on identity.terminal_pin_attempts to identity_api;

alter table identity.terminal_pin_attempts enable row level security;
create policy terminal_pin_attempts_rw on identity.terminal_pin_attempts
  for all to identity_api
  using (identity.is_system()) with check (identity.is_system());
