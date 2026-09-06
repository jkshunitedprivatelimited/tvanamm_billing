-- Operational notifications (`docs/architecture/operational-notifications.md`)
-- - in-app is the authoritative operational channel; no operational SMS. A
-- notification never grants access by itself; opening one routes to an
-- already-authorized filtered record.

create type identity.notification_severity as enum ('info', 'warning', 'critical');

create table identity.notifications (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references billing.organizations(id) on delete cascade,
  franchise_id         uuid references billing.franchises(id) on delete cascade,
  outlet_id            uuid references billing.outlets(id) on delete cascade,
  -- Scope: a role (everyone in that role within franchise/outlet) and/or a
  -- specific account. At least one narrows who sees it.
  recipient_role       text check (recipient_role in ('central_admin','accountant','franchise_owner','store_employee')),
  recipient_account_id uuid references identity.account_profiles(id) on delete cascade,
  category             text not null check (length(btrim(category)) between 1 and 60),
  severity             identity.notification_severity not null default 'info',
  title                text not null check (length(btrim(title)) between 1 and 200),
  body                 text check (body is null or length(body) <= 2000),
  entity_type          text,
  entity_id            uuid,
  dedup_key            text not null,
  event_count          integer not null default 1,
  created_at           timestamptz not null default now(),
  read_at              timestamptz,
  resolved_at          timestamptz,
  constraint notifications_scope_present check (
    recipient_role is not null or recipient_account_id is not null
  ),
  constraint notifications_dedup_uniq unique (organization_id, dedup_key)
);
create index notifications_role_scope_idx
  on identity.notifications(organization_id, recipient_role, created_at desc);
create index notifications_account_idx
  on identity.notifications(recipient_account_id, created_at desc) where recipient_account_id is not null;
create index notifications_unread_idx
  on identity.notifications(organization_id) where read_at is null;

-- A user may mute an informational category; mandatory categories are
-- enforced in the API, not here.
create table identity.notification_mutes (
  account_id uuid not null references identity.account_profiles(id) on delete cascade,
  category   text not null,
  muted_at   timestamptz not null default now(),
  primary key (account_id, category)
);

grant select, insert, update on identity.notifications to identity_api;
grant select, insert, delete on identity.notification_mutes to identity_api;

alter table identity.notifications    enable row level security;
alter table identity.notification_mutes enable row level security;

-- Read: a notification is visible if it is addressed to this account
-- directly, or to this actor's role within a scope that covers them.
create policy notifications_read on identity.notifications for select to identity_api using (
  identity.is_system()
  or recipient_account_id = identity.ctx_uuid('account_id')
  or (
    recipient_role = identity.ctx('role')
    and organization_id = identity.ctx_uuid('organization_id')
    and (franchise_id is null or franchise_id = identity.ctx_uuid('franchise_id')
         or identity.is_central() or identity.is_accountant())
    and (outlet_id is null or outlet_id = identity.ctx_uuid('outlet_id')
         or identity.is_central() or identity.is_accountant()
         or identity.is_owner_of(franchise_id))
  )
);
-- Only the system emits notifications; a user may only stamp read/resolved
-- on rows already visible to them (the read policy also gates FOR UPDATE).
create policy notifications_write on identity.notifications for all to identity_api using (
  identity.is_system()
  or recipient_account_id = identity.ctx_uuid('account_id')
  or (recipient_role = identity.ctx('role') and organization_id = identity.ctx_uuid('organization_id'))
) with check (
  identity.is_system()
  or recipient_account_id = identity.ctx_uuid('account_id')
  or (recipient_role = identity.ctx('role') and organization_id = identity.ctx_uuid('organization_id'))
);

create policy notification_mutes_rw on identity.notification_mutes for all to identity_api
  using (account_id = identity.ctx_uuid('account_id'))
  with check (account_id = identity.ctx_uuid('account_id'));
