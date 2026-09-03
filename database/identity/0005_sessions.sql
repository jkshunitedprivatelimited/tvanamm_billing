-- Stage 1 - Authentication sessions and workstation sessions.
-- The shift session is a separate concept and lands in a later stage.

create type identity.session_kind  as enum ('admin', 'store_pin');
create type identity.session_state as enum (
  'active', 'step_up_required', 'expired', 'revoked'
);

create table identity.sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references identity.users(id) on delete cascade,
  kind                identity.session_kind not null,
  state               identity.session_state not null default 'active',
  -- Selected workspace once resolved (null until the user picks / is routed).
  membership_id       uuid references identity.memberships(id) on delete set null,
  -- Opaque reference to the Supabase Auth session for admin logins.
  auth_provider_ref   text,
  -- Hash of the rotating refresh token; null for short PIN sessions.
  refresh_token_hash  text,
  device              jsonb not null default '{}'::jsonb,
  ip                  inet,
  created_at          timestamptz not null default now(),
  -- When the account last completed a strong challenge (OTP verify / PIN).
  -- Drives "fresh authentication" checks for sensitive admin/owner actions.
  authenticated_at    timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  idle_expires_at     timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at          timestamptz,
  revoked_reason      text
);
create index sessions_user_id_idx on identity.sessions(user_id);
create index sessions_active_idx on identity.sessions(user_id)
  where state = 'active';

-- Registered terminal + outlet + current operator. `Lock` keeps the row and
-- hides POS data; `Logout` ends it and the client clears local data.
create table identity.workstation_sessions (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references identity.sessions(id) on delete cascade,
  terminal_id      uuid not null references identity.terminals(id) on delete restrict,
  outlet_id        uuid not null references identity.outlets(id) on delete restrict,
  operator_user_id uuid not null references identity.users(id) on delete restrict,
  state            text not null default 'active' check (state in ('active', 'locked', 'ended')),
  opened_at        timestamptz not null default now(),
  locked_at        timestamptz,
  ended_at         timestamptz
);
-- At most one active/locked workstation session per terminal.
create unique index workstation_sessions_one_open_per_terminal
  on identity.workstation_sessions(terminal_id)
  where state in ('active', 'locked');
create index workstation_sessions_session_id_idx
  on identity.workstation_sessions(session_id);
