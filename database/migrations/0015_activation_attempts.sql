-- Stage 1 hardening (previously deferred P2) - throttle terminal activation-code
-- registration attempts. Codes are single-use, expiring, and outlet-bound, but a
-- caller that can reach the endpoint should still not be able to hammer it. The
-- key is the caller IP when a trusted proxy supplies one, else a single global
-- bucket.

create table identity.activation_attempts (
  client_key        text primary key,
  failed_count      integer not null default 0,
  last_failed_at    timestamptz,
  locked_until      timestamptz,
  window_started_at timestamptz not null default now()
);

grant select, insert, update, delete on identity.activation_attempts to identity_api;

alter table identity.activation_attempts enable row level security;
create policy activation_attempts_rw on identity.activation_attempts
  for all to identity_api
  using (identity.is_system()) with check (identity.is_system());
