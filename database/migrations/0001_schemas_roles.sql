-- Stage 1 - Schemas, extensions, and least-privilege API roles.
-- docs/plans/billing-data-api-plan.md §1, §2, §13.1

create schema if not exists identity;
create schema if not exists billing;
create schema if not exists audit;
create schema if not exists outbox;

create extension if not exists pgcrypto;
create extension if not exists citext;

-- Least-privilege roles the TypeScript APIs connect as. NOLOGIN: the pooled
-- connection authenticates as the project owner and does `set local role` per
-- transaction, so RLS and grants apply to normal request handling. The
-- unrestricted owner/service role is reserved for migrations and exceptional
-- managed-auth operations only.
do $$
begin
  if not exists (select from pg_roles where rolname = 'identity_api') then
    create role identity_api nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'billing_api') then
    create role billing_api nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'job_worker') then
    create role job_worker nologin;
  end if;
  -- The pooled connection authenticates as this role and does `set local role`
  -- per transaction, so it must be a member of the API roles.
  execute format('grant identity_api, billing_api, job_worker to %I', current_user);
end
$$;

grant usage on schema identity, billing, audit, outbox to identity_api, billing_api, job_worker;

-- Supabase provides these; create no-op stubs on a plain Postgres so later
-- migrations that reference them still load (CI / local integration).
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

-- Shared updated_at trigger.
create or replace function identity.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Rejects UPDATE/DELETE, used to make append-only tables truly append-only.
create or replace function identity.reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name;
end;
$$;
