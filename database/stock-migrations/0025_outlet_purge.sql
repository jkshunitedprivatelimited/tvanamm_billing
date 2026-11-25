-- Permanent outlet purge — Stock side (Central Admin only).
--
-- Billing's purge of a closed outlet calls stock.purge_outlet first. It removes
-- every Stock row recorded against the outlet (locations, balances, movements,
-- orders, inwards, counts, wastage, settings, audit), the franchise's rows when
-- the franchise is being removed too, and the identity projection rows of the
-- owner logins Billing is deleting.
--
-- Append-only tables keep rejecting UPDATE/DELETE except inside this function:
-- it runs as the table owner and raises `jksh.purge` for its own transaction.
-- The purge itself only deletes; the UPDATEs let through are the ON DELETE SET
-- NULL actions Postgres runs on child rows. stock_api has no DELETE grant on
-- those tables, so the flag alone grants nothing.

create or replace function stock.reject_mutation()
returns trigger language plpgsql as $$
begin
  if current_setting('jksh.purge', true) = 'on' and current_user <> 'stock_api' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name;
end;
$$;

-- Same contract as identity.purge_cascade in the Billing database.
create or replace function stock.purge_cascade(rel regclass, cond text, depth int default 0)
returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  fk record;
  ccols text;
  pcols text;
begin
  if depth > 12 then
    raise exception 'purge: foreign-key chain too deep at %', rel;
  end if;
  for fk in
    select c.conrelid::regclass as child, c.conkey, c.confkey
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = rel and c.conrelid <> rel
      and c.confdeltype not in ('n', 'd')
  loop
    select string_agg(quote_ident(a.attname), ',' order by k.ord) into ccols
      from unnest(fk.conkey) with ordinality k(n, ord)
      join pg_attribute a on a.attrelid = fk.child and a.attnum = k.n;
    select string_agg(quote_ident(a.attname), ',' order by k.ord) into pcols
      from unnest(fk.confkey) with ordinality k(n, ord)
      join pg_attribute a on a.attrelid = rel and a.attnum = k.n;
    perform stock.purge_cascade(
      fk.child,
      format('(%s) in (select %s from %s where %s)', ccols, pcols, rel, cond),
      depth + 1);
  end loop;
  execute format('delete from %s where %s', rel, cond);
end;
$$;
revoke all on function stock.purge_cascade(regclass, text, int) from public;

create or replace function stock.purge_outlet(
  p_outlet uuid, p_franchise uuid, p_accounts uuid[]
) returns void language plpgsql security definer
set search_path = pg_catalog, pg_temp as $$
declare
  t record;
begin
  if not stock.is_central() then
    raise exception 'purge: only Central Admin can delete an outlet' using errcode = '42501';
  end if;

  perform set_config('jksh.purge', 'on', true);

  for t in
    select c.oid::regclass as rel,
           bool_or(a.attname = 'outlet_id') as has_outlet,
           bool_or(a.attname = 'franchise_id') as has_franchise
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and not a.attisdropped
     where c.relkind = 'r'
       and n.nspname like 'stock%'
       and n.nspname <> 'stock_migrations'
       and a.attname in ('outlet_id', 'franchise_id')
     group by c.oid
  loop
    if t.has_outlet then
      perform stock.purge_cascade(t.rel, format('outlet_id = %L::uuid', p_outlet));
    end if;
    if t.has_franchise and p_franchise is not null then
      perform stock.purge_cascade(t.rel, format('franchise_id = %L::uuid', p_franchise));
    end if;
  end loop;

  if cardinality(coalesce(p_accounts, '{}')) > 0 then
    perform stock.purge_cascade('stock.identity_projection'::regclass,
                                format('account_id = any(%L::uuid[])', p_accounts));
  end if;

  perform set_config('jksh.purge', 'off', true);
end;
$$;

revoke all on function stock.purge_outlet(uuid, uuid, uuid[]) from public;
grant execute on function stock.purge_outlet(uuid, uuid, uuid[]) to stock_api;
