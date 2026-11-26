-- Automatic stock deduction: pg_cron on the Billing database calls the admin
-- endpoint /api/v1/stock/scheduled-cycle every minute through pg_net.
--
-- The endpoint URL and its bearer secret live in Supabase Vault (never in this
-- file) under the names 'stock_scheduler_url' and 'stock_scheduler_secret'.
-- Until both exist the function is a no-op, so applying this is always safe.
create or replace function billing.trigger_stock_event_cycle()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'stock_scheduler_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'stock_scheduler_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || v_secret,
      'content-type', 'application/json'
    ),
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function billing.trigger_stock_event_cycle() from public;

-- Hosted Supabase has pg_cron + pg_net + Vault. Plain local Postgres skips this.
do $schedule$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_namespace where nspname = 'vault') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('stock-event-cycle', '* * * * *',
      'select billing.trigger_stock_event_cycle()');
  else
    raise notice 'pg_cron/pg_net/vault unavailable: call POST /api/v1/stock/scheduled-cycle every minute in this environment';
  end if;
end;
$schedule$;
