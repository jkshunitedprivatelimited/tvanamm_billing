-- Stage 1 - Registered store terminals, revocable credentials, activation codes.

create type identity.terminal_state as enum (
  'pending', 'active', 'locked', 'revoked'
);

create table identity.terminals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references identity.organizations(id) on delete restrict,
  franchise_id     uuid not null references identity.franchises(id) on delete restrict,
  outlet_id        uuid not null references identity.outlets(id) on delete restrict,
  label            text not null,
  state            identity.terminal_state not null default 'pending',
  -- Daily receipt sequence prefix, unique within the outlet: T01, T02, ...
  receipt_prefix   text not null check (receipt_prefix ~ '^T\d{2}$'),
  app_version      text,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references identity.users(id) on delete set null,
  revoked_at       timestamptz,
  revoked_reason   text
);
create index terminals_outlet_id_idx on identity.terminals(outlet_id);
create index terminals_state_idx on identity.terminals(state);
-- MVP: one active Billing terminal per outlet. Registering a replacement revokes
-- the previous one; a revoked row keeps its prefix without blocking the new one.
create unique index terminals_outlet_one_active
  on identity.terminals(outlet_id)
  where state <> 'revoked';
create unique index terminals_outlet_prefix_active
  on identity.terminals(outlet_id, receipt_prefix)
  where state <> 'revoked';

-- Hashed, revocable, rotatable terminal credentials. The device holds an opaque
-- bearer credential; the server stores only the hash of its secret nonce.
create table identity.terminal_credentials (
  id             uuid primary key default gen_random_uuid(),
  terminal_id    uuid not null references identity.terminals(id) on delete cascade,
  nonce_hash     text not null,
  state          text not null default 'active' check (state in ('active', 'revoked')),
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_reason text,
  rotated_from   uuid references identity.terminal_credentials(id) on delete set null
);
-- Exactly one active credential per terminal.
create unique index terminal_credentials_one_active
  on identity.terminal_credentials(terminal_id)
  where state = 'active';
create index terminal_credentials_lookup
  on identity.terminal_credentials(terminal_id, nonce_hash);

create table identity.terminal_activation_codes (
  id                  uuid primary key default gen_random_uuid(),
  outlet_id           uuid not null references identity.outlets(id) on delete cascade,
  organization_id     uuid not null references identity.organizations(id) on delete cascade,
  franchise_id        uuid not null references identity.franchises(id) on delete cascade,
  label               text not null,
  -- Hash of the human-entered code. The clear code is shown once to the owner.
  code_hash           text not null,
  expires_at          timestamptz not null,
  created_by          uuid references identity.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  consumed_at         timestamptz,
  consumed_terminal_id uuid references identity.terminals(id) on delete set null
);
create index activation_codes_outlet_id_idx
  on identity.terminal_activation_codes(outlet_id);
create index activation_codes_open_idx
  on identity.terminal_activation_codes(expires_at)
  where consumed_at is null;
