-- Stage 1 - Append-only audit log and transactional outbox.
-- docs/plans/billing-data-api-plan.md §9

create type audit.result as enum ('success', 'failure', 'denied');

create table audit.events (
  id               uuid primary key default gen_random_uuid(),
  action           text not null,
  result           audit.result not null,
  occurred_at      timestamptz not null default now(),
  actor_account_id uuid,
  actor_employee_id uuid,
  subject_id       uuid,
  organization_id  uuid,
  franchise_id     uuid,
  outlet_id        uuid,
  session_id       uuid,
  terminal_id      uuid,
  correlation_id   uuid not null,
  -- Safe, redacted metadata only. Never PINs, OTP codes, tokens, or bodies.
  metadata         jsonb not null default '{}'::jsonb
);
create index audit_events_occurred_idx on audit.events(occurred_at desc);
create index audit_events_org_idx on audit.events(organization_id, occurred_at desc);
create index audit_events_outlet_idx on audit.events(outlet_id, occurred_at desc);
create index audit_events_actor_idx on audit.events(actor_account_id, occurred_at desc);
create index audit_events_action_idx on audit.events(action, occurred_at desc);

create trigger audit_events_no_update before update on audit.events
  for each row execute function identity.reject_mutation();
create trigger audit_events_no_delete before delete on audit.events
  for each row execute function identity.reject_mutation();

grant select, insert on audit.events to identity_api;
grant insert on audit.events to billing_api;

alter table audit.events enable row level security;
create policy audit_insert on audit.events for insert to identity_api, billing_api
  with check (true);
create policy audit_read on audit.events for select to identity_api
  using (
    identity.is_central() or identity.is_accountant()
    or franchise_id = identity.ctx_uuid('franchise_id')
  );

-- Transactional integration events (SaleCompleted / SaleRefunded in Stage 3).
create table outbox.events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,
  event_version   integer not null default 1,
  aggregate_id    uuid not null,
  organization_id uuid not null,
  franchise_id    uuid,
  outlet_id       uuid not null,
  correlation_id  uuid not null,
  idempotency_key text not null,
  payload         jsonb not null,
  status          text not null default 'pending'
    check (status in ('pending', 'delivered', 'dead_letter')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (event_type, idempotency_key)
);
create index outbox_events_pending_idx on outbox.events(next_attempt_at)
  where status = 'pending';

grant insert on outbox.events to identity_api, billing_api;
grant select, update on outbox.events to job_worker;

alter table outbox.events enable row level security;
create policy outbox_insert on outbox.events for insert to identity_api, billing_api
  with check (true);
