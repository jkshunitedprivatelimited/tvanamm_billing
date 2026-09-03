-- Stage 1 - Store employees, terminals, and operator sessions.
-- docs/plans/billing-data-api-plan.md §3

create type identity.employee_status as enum ('active', 'suspended', 'disabled');

create table identity.store_employees (
  id             uuid primary key default gen_random_uuid(),
  outlet_id      uuid not null references billing.outlets(id) on delete restrict,
  organization_id uuid not null references billing.organizations(id) on delete restrict,
  franchise_id   uuid references billing.franchises(id) on delete restrict,
  employee_code  text not null unique check (employee_code ~ '^EMP-[A-Z0-9]{6,10}$'),
  full_name      text not null,
  mobile         text not null,                  -- normalized E.164
  status         identity.employee_status not null default 'active',

  -- Four-digit PIN. Strong salted hash + a deterministic keyed lookup that
  -- enforces outlet-local uniqueness and finds the one candidate at login.
  pin_hash       text,
  pin_version    integer not null default 0,
  pin_lookup     bytea,
  pin_set_at     timestamptz,
  pin_set_by     uuid references identity.account_profiles(id) on delete set null,

  failed_attempts integer not null default 0,
  last_failed_at  timestamptz,
  lock_time       timestamptz,

  created_by     uuid references identity.account_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint store_employees_pin_pair
    check ((pin_hash is null) = (pin_lookup is null))
);
create unique index store_employees_outlet_pin_uniq
  on identity.store_employees(outlet_id, pin_lookup) where pin_lookup is not null;
create index store_employees_outlet_id_idx on identity.store_employees(outlet_id);
create trigger store_employees_set_updated_at before update on identity.store_employees
  for each row execute function identity.set_updated_at();

create type identity.terminal_status as enum ('pending', 'active', 'locked', 'revoked');

create table identity.terminals (
  id                 uuid primary key default gen_random_uuid(),
  outlet_id          uuid not null references billing.outlets(id) on delete restrict,
  organization_id    uuid not null references billing.organizations(id) on delete restrict,
  franchise_id       uuid references billing.franchises(id) on delete restrict,
  name               text not null,
  status             identity.terminal_status not null default 'pending',
  -- Daily receipt-sequence prefix, unique within the outlet: T01, T02, ...
  receipt_prefix     text not null check (receipt_prefix ~ '^T\d{2}$'),
  paper_width_mm     integer not null default 80 check (paper_width_mm in (58, 80)),
  app_version        text,
  last_validated_at  timestamptz,
  last_synced_at     timestamptz,
  enrolled_by        uuid references identity.account_profiles(id) on delete set null,
  enrolled_at        timestamptz not null default now(),
  revoked_by         uuid references identity.account_profiles(id) on delete set null,
  revoked_at         timestamptz,
  revoked_reason     text
);
-- MVP: one active Billing terminal per outlet; a revoked row keeps its prefix.
create unique index terminals_outlet_one_active on identity.terminals(outlet_id)
  where status <> 'revoked';
create unique index terminals_outlet_prefix_active on identity.terminals(outlet_id, receipt_prefix)
  where status <> 'revoked';
create index terminals_outlet_id_idx on identity.terminals(outlet_id);

-- Hashed, revocable, rotatable terminal credentials.
create table identity.terminal_credentials (
  id             uuid primary key default gen_random_uuid(),
  terminal_id    uuid not null references identity.terminals(id) on delete cascade,
  public_id      text not null,
  nonce_hash     text not null,
  version        integer not null default 1,
  status         text not null default 'active' check (status in ('active', 'revoked')),
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_reason text,
  rotated_from   uuid references identity.terminal_credentials(id) on delete set null
);
create unique index terminal_credentials_one_active on identity.terminal_credentials(terminal_id)
  where status = 'active';
create index terminal_credentials_lookup on identity.terminal_credentials(terminal_id, nonce_hash);

create table identity.terminal_activation_codes (
  id                   uuid primary key default gen_random_uuid(),
  outlet_id            uuid not null references billing.outlets(id) on delete cascade,
  organization_id      uuid not null references billing.organizations(id) on delete cascade,
  franchise_id         uuid references billing.franchises(id) on delete cascade,
  label                text not null,
  code_hash            text not null,
  expires_at           timestamptz not null,
  created_by           uuid references identity.account_profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  consumed_at          timestamptz,
  consumed_terminal_id uuid references identity.terminals(id) on delete set null
);
create index activation_codes_outlet_id_idx on identity.terminal_activation_codes(outlet_id);
create index activation_codes_open_idx on identity.terminal_activation_codes(expires_at)
  where consumed_at is null;

-- Short-lived Store Employee operator sessions (PIN login, our own token).
create type identity.operator_session_status as enum ('active', 'locked', 'ended');

create table identity.operator_sessions (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references identity.store_employees(id) on delete restrict,
  terminal_id      uuid not null references identity.terminals(id) on delete restrict,
  outlet_id        uuid not null references billing.outlets(id) on delete restrict,
  shift_id         uuid,                          -- Stage 3
  status           identity.operator_session_status not null default 'active',
  token_hash       text not null,
  device           jsonb not null default '{}'::jsonb,
  offline_bundle_version text,
  issued_at        timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  locked_at        timestamptz,
  ended_at         timestamptz,
  revoked_reason   text
);
create unique index operator_sessions_one_open_per_terminal on identity.operator_sessions(terminal_id)
  where status in ('active', 'locked');
create index operator_sessions_employee_idx on identity.operator_sessions(employee_id);
