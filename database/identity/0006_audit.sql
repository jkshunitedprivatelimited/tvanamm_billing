-- Stage 1 - Append-only security audit log in its own schema
-- (docs/architecture/platform-decisions.md: identity | billing | audit | outbox).

create schema if not exists audit;

create type audit.result as enum ('success', 'failure', 'denied');

create table audit.auth_events (
  id               uuid primary key default gen_random_uuid(),
  action           text not null,
  result           audit.result not null,
  occurred_at      timestamptz not null default now(),
  actor_user_id    uuid,
  subject_user_id  uuid,
  organization_id  uuid,
  franchise_id     uuid,
  outlet_id        uuid,
  session_id       uuid,
  terminal_id      uuid,
  correlation_id   uuid not null,
  -- Safe, non-sensitive metadata only. Never PINs, OTP codes, tokens, bodies.
  metadata         jsonb not null default '{}'::jsonb
);

create index auth_events_occurred_at_idx on audit.auth_events(occurred_at desc);
create index auth_events_org_time_idx
  on audit.auth_events(organization_id, occurred_at desc);
create index auth_events_outlet_time_idx
  on audit.auth_events(outlet_id, occurred_at desc);
create index auth_events_actor_time_idx
  on audit.auth_events(actor_user_id, occurred_at desc);
create index auth_events_action_time_idx
  on audit.auth_events(action, occurred_at desc);

-- Enforce append-only: block UPDATE and DELETE at the database level.
create or replace function audit.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit.auth_events is append-only';
end;
$$;

create trigger auth_events_no_update
  before update on audit.auth_events
  for each row execute function audit.reject_mutation();

create trigger auth_events_no_delete
  before delete on audit.auth_events
  for each row execute function audit.reject_mutation();
