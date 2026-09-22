-- Midnight rollover is a system close, never a claim that cash was counted.
alter table billing.cash_sessions drop constraint cash_sessions_close_shape;
alter table billing.cash_sessions add constraint cash_sessions_close_shape check (
  status = 'open'
  or (status = 'closed' and closed_by_employee_id is not null
      and closed_at is not null and counted_cash is not null)
  or (status = 'force_closed' and closed_at is not null and force_close_reason is not null)
);

create function billing.close_expired_business_days(p_now timestamptz default now())
returns integer language plpgsql set search_path = pg_catalog as $$
declare
  outlet record;
  session record;
  shift record;
  today date;
  expected numeric(12,2);
  closed_count integer := 0;
  reason constant text := 'Automatic midnight close; physical cash count not recorded. Reconciliation required.';
begin
  for outlet in
    select o.id, o.timezone from billing.outlets o
    where exists (select 1 from billing.cash_sessions c where c.outlet_id = o.id
                  and c.status = 'open' and c.business_date < (p_now at time zone o.timezone)::date)
       or exists (select 1 from billing.employee_shifts s where s.outlet_id = o.id
                  and s.status = 'open' and s.business_date < (p_now at time zone o.timezone)::date)
    order by o.id
  loop
    perform pg_advisory_xact_lock(hashtextextended('outlet-work:' || outlet.id::text, 0));
    today := (p_now at time zone outlet.timezone)::date;
    for session in
      select * from billing.cash_sessions
      where outlet_id = outlet.id and status = 'open' and business_date < today
      order by id for update
    loop
      select session.opening_cash
        + coalesce((select sum(p.amount) from billing.payments p
                    join billing.bills b on b.id = p.bill_id
                    where b.cash_session_id = session.id and p.method = 'cash'), 0)
        - coalesce((select sum(r.amount) from billing.refunds r
                    where r.cash_session_id = session.id and r.payout_method = 'cash'), 0)
        - coalesce((select sum(e.amount) from billing.outlet_expenses e
                    where e.cash_session_id = session.id and e.payment_source = 'shared_cash_drawer'
                      and e.reversed_at is null), 0)
      into expected;
      update billing.cash_sessions set status = 'force_closed', closed_at = p_now,
        closed_by_name = 'System (midnight close)', expected_cash = expected,
        counted_cash = null, variance = null, force_close_reason = reason
      where id = session.id;
      insert into audit.events (action, result, organization_id, franchise_id, outlet_id,
                                subject_id, correlation_id, metadata)
      values ('cash_session.force_closed', 'success', session.organization_id,
              session.franchise_id, outlet.id, session.id, gen_random_uuid(),
              jsonb_build_object('cashSessionId', session.id, 'businessDate', session.business_date,
                'automatic', true, 'reason', reason, 'expectedCash', expected,
                'reconciliationRequired', true));
      closed_count := closed_count + 1;
    end loop;
    for shift in
      select * from billing.employee_shifts
      where outlet_id = outlet.id and status = 'open' and business_date < today
      order by id for update
    loop
      update billing.employee_shifts set status = 'force_closed', ended_at = p_now,
        force_close_reason = 'Automatic midnight business-day close',
        bill_count = (select count(*) from billing.bills b where b.shift_id = shift.id)
      where id = shift.id;
      insert into audit.events (action, result, organization_id, franchise_id, outlet_id,
                                subject_id, correlation_id, metadata)
      values ('shift.force_closed', 'success', shift.organization_id, shift.franchise_id,
              outlet.id, shift.id, gen_random_uuid(),
              jsonb_build_object('shiftId', shift.id, 'businessDate', shift.business_date,
                'automatic', true, 'reason', 'Automatic midnight business-day close'));
    end loop;
  end loop;
  return closed_count;
end;
$$;
-- Only the migration owner / scheduler may run this cross-outlet operation.
revoke all on function billing.close_expired_business_days(timestamptz) from public;

-- Hosted Supabase has pg_cron. Plain local Postgres can test the function directly.
do $schedule$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('billing-midnight-close', '* * * * *',
      'select billing.close_expired_business_days()');
  else
    raise notice 'pg_cron unavailable: schedule billing.close_expired_business_days() every minute in this environment';
  end if;
end;
$schedule$;
