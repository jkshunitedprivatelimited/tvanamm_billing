-- Stage 1 - Row Level Security as defense in depth.
--
-- Every privileged operation in Stage 1 runs through Next.js server code using
-- the Supabase secret key (which bypasses RLS) and enforces capability + scope
-- in @jksh/identity. These policies exist so that any accidental access with an
-- `anon` or `authenticated` role is denied by default rather than open.

-- Supabase provides the anon / authenticated / service_role roles. On a plain
-- Postgres (CI, local integration tests) create them so the policies below load.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- Supabase projects already provide auth.uid(). On a plain Postgres (CI, local
-- integration tests) create a compatible stub so the policies below load.
do $$
begin
  if to_regprocedure('auth.uid()') is null then
    create schema if not exists auth;
    execute $f$
      create function auth.uid() returns uuid language sql stable as $inner$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $inner$
    $f$;
  end if;
end
$$;

alter table identity.organizations             enable row level security;
alter table identity.brands                    enable row level security;
alter table identity.franchises                enable row level security;
alter table identity.outlets                   enable row level security;
alter table identity.users                     enable row level security;
alter table identity.otp_attempts              enable row level security;
alter table identity.roles                     enable row level security;
alter table identity.permissions               enable row level security;
alter table identity.role_permissions          enable row level security;
alter table identity.memberships               enable row level security;
alter table identity.invitations               enable row level security;
alter table identity.terminals                 enable row level security;
alter table identity.terminal_credentials      enable row level security;
alter table identity.terminal_activation_codes enable row level security;
alter table identity.store_employees           enable row level security;
alter table identity.employee_pins             enable row level security;
alter table identity.pin_attempts              enable row level security;
alter table identity.terminal_pin_attempts     enable row level security;
alter table identity.sessions                  enable row level security;
alter table identity.workstation_sessions      enable row level security;
alter table identity.schema_migrations         enable row level security;
alter table audit.auth_events                  enable row level security;

-- No permissive policies are defined for anon/authenticated: default deny.
-- The secret-key server client is unaffected and remains the only access path.

-- A signed-in admin may read their own user row and their own memberships.
-- This is the single narrow exception, useful for client-side hydration checks.
create policy users_self_read on identity.users
  for select to authenticated
  using (id = auth.uid());

create policy memberships_self_read on identity.memberships
  for select to authenticated
  using (user_id = auth.uid());
