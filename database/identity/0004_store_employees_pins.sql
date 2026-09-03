-- Stage 1 - Store Employee records, hashed four-digit PINs, throttle/lockout.

create table identity.store_employees (
  user_id        uuid primary key references identity.users(id) on delete cascade,
  outlet_id      uuid not null references identity.outlets(id) on delete restrict,
  franchise_id   uuid not null references identity.franchises(id) on delete restrict,
  employee_code  text not null unique check (employee_code ~ '^EMP-[A-Z0-9]{6,10}$'),
  full_name      text not null,
  phone          text not null,
  created_by     uuid references identity.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index store_employees_outlet_id_idx on identity.store_employees(outlet_id);
create trigger store_employees_set_updated_at
  before update on identity.store_employees
  for each row execute function identity.set_updated_at();

create table identity.employee_pins (
  user_id     uuid primary key references identity.users(id) on delete cascade,
  outlet_id   uuid not null references identity.outlets(id) on delete restrict,
  -- Salted argon2id hash of the PIN; used to verify a candidate.
  pin_hash    text not null,
  pin_algo    text not null default 'argon2id',
  -- Deterministic keyed hash: hmac(secret || outlet_id, pin). Enforces
  -- outlet-local PIN uniqueness and lets store login find the one candidate row
  -- without scanning every argon2 hash in the outlet.
  pin_lookup  bytea not null,
  set_at      timestamptz not null default now(),
  set_by      uuid references identity.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (outlet_id, pin_lookup)
);
create trigger employee_pins_set_updated_at
  before update on identity.employee_pins
  for each row execute function identity.set_updated_at();

-- Per-employee PIN failure counter and temporary lockout.
create table identity.pin_attempts (
  user_id       uuid primary key references identity.users(id) on delete cascade,
  outlet_id     uuid not null references identity.outlets(id) on delete restrict,
  failed_count  integer not null default 0,
  last_failed_at timestamptz,
  locked_until  timestamptz
);

-- Per-terminal PIN failure counter, independent of which employee was tried.
create table identity.terminal_pin_attempts (
  terminal_id      uuid primary key references identity.terminals(id) on delete cascade,
  failed_count     integer not null default 0,
  window_started_at timestamptz not null default now(),
  last_failed_at   timestamptz,
  locked_until     timestamptz
);
