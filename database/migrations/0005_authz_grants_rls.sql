-- Stage 1 - Authorization context, grants, and Row Level Security.
-- docs/plans/billing-data-api-plan.md §2, §13.4
--
-- The API sets a per-transaction context with `set local`:
--   app.request  = 'system' | 'admin' | 'operator'
--   app.account_id, app.role, app.organization_id, app.franchise_id, app.outlet_id
--   app.operator_employee_id
-- and `set local role identity_api`, so RLS + grants apply to normal requests.
-- 'system' is a trusted pre-authentication mode used only by OTP link, PIN
-- login, terminal registration, and invitation acceptance.

create or replace function identity.ctx(name text) returns text
  language sql stable as $$ select nullif(current_setting('app.' || name, true), '') $$;

create or replace function identity.ctx_uuid(name text) returns uuid
  language sql stable as $$ select nullif(current_setting('app.' || name, true), '')::uuid $$;

create or replace function identity.is_system() returns boolean
  language sql stable as $$ select identity.ctx('request') = 'system' $$;

create or replace function identity.is_central() returns boolean
  language sql stable as $$ select identity.ctx('role') = 'central_admin' $$;

create or replace function identity.is_accountant() returns boolean
  language sql stable as $$ select identity.ctx('role') = 'accountant' $$;

create or replace function identity.is_owner_of(f uuid) returns boolean
  language sql stable as $$
    select identity.ctx('role') = 'franchise_owner' and f is not null and f = identity.ctx_uuid('franchise_id')
  $$;

-- ---- Grants ---------------------------------------------------------------

grant select on billing.organizations, billing.brands to identity_api;
grant select, insert, update on billing.franchises, billing.outlets to identity_api;

grant select on identity.roles, identity.capabilities, identity.role_capabilities to identity_api;
grant select, insert, update on
  identity.account_profiles,
  identity.memberships,
  identity.invitations,
  identity.otp_attempts,
  identity.store_employees,
  identity.terminals,
  identity.terminal_credentials,
  identity.terminal_activation_codes,
  identity.operator_sessions
  to identity_api;

-- audit.events / outbox.events grants + policies live in 0006 (tables defined there).

-- ---- RLS: billing tenancy ----------------------------------------------

alter table billing.organizations enable row level security;
alter table billing.brands        enable row level security;
alter table billing.franchises    enable row level security;
alter table billing.outlets       enable row level security;

create policy org_read on billing.organizations for select to identity_api using (true);
create policy brand_read on billing.brands for select to identity_api using (true);

create policy franchise_read on billing.franchises for select to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_accountant()
         or id = identity.ctx_uuid('franchise_id'));
create policy franchise_write on billing.franchises for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());

create policy outlet_read on billing.outlets for select to identity_api
  using (
    identity.is_system() or identity.is_central() or identity.is_accountant()
    or franchise_id = identity.ctx_uuid('franchise_id')
    or id = identity.ctx_uuid('outlet_id')
  );
create policy outlet_insert on billing.outlets for insert to identity_api
  with check (identity.is_system() or identity.is_central());
create policy outlet_update on billing.outlets for update to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id))
  with check (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));

-- ---- RLS: identity -----------------------------------------------------

alter table identity.roles                    enable row level security;
alter table identity.capabilities             enable row level security;
alter table identity.role_capabilities        enable row level security;
alter table identity.account_profiles         enable row level security;
alter table identity.memberships              enable row level security;
alter table identity.invitations              enable row level security;
alter table identity.otp_attempts             enable row level security;
alter table identity.store_employees          enable row level security;
alter table identity.terminals                enable row level security;
alter table identity.terminal_credentials     enable row level security;
alter table identity.terminal_activation_codes enable row level security;
alter table identity.operator_sessions        enable row level security;
alter table identity.schema_migrations        enable row level security;

create policy roles_read on identity.roles for select to identity_api using (true);
create policy caps_read on identity.capabilities for select to identity_api using (true);
create policy rolecaps_read on identity.role_capabilities for select to identity_api using (true);

create policy account_read on identity.account_profiles for select to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_accountant()
         or id = identity.ctx_uuid('account_id'));
create policy account_write on identity.account_profiles for all to identity_api
  using (identity.is_system() or identity.is_central() or id = identity.ctx_uuid('account_id'))
  with check (identity.is_system() or identity.is_central() or id = identity.ctx_uuid('account_id'));

create policy membership_read on identity.memberships for select to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_accountant()
         or account_id = identity.ctx_uuid('account_id'));
create policy membership_write on identity.memberships for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());

create policy invitation_rw on identity.invitations for all to identity_api
  using (identity.is_system() or identity.is_central())
  with check (identity.is_system() or identity.is_central());

create policy otp_rw on identity.otp_attempts for all to identity_api
  using (identity.is_system()) with check (identity.is_system());

create policy employee_read on identity.store_employees for select to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_accountant()
         or identity.is_owner_of(franchise_id));
create policy employee_write on identity.store_employees for all to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id))
  with check (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));

create policy terminal_read on identity.terminals for select to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));
create policy terminal_write on identity.terminals for all to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id))
  with check (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));

create policy termcred_rw on identity.terminal_credentials for all to identity_api
  using (identity.is_system() or identity.is_central()
         or terminal_id in (select id from identity.terminals))
  with check (identity.is_system() or identity.is_central()
              or terminal_id in (select id from identity.terminals));

create policy actcode_read on identity.terminal_activation_codes for select to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));
create policy actcode_write on identity.terminal_activation_codes for all to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id))
  with check (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));

create policy opsession_rw on identity.operator_sessions for all to identity_api
  using (
    identity.is_system() or identity.is_central()
    or outlet_id in (select o.id from billing.outlets o
                      where o.franchise_id = identity.ctx_uuid('franchise_id'))
  )
  with check (
    identity.is_system() or identity.is_central()
    or outlet_id in (select o.id from billing.outlets o
                      where o.franchise_id = identity.ctx_uuid('franchise_id'))
  );
