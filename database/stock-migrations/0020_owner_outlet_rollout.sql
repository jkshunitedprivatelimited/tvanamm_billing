-- Restrictive policies AND with existing authorization, never grant new access.
-- Parent-table policies also constrain lines/payments that use EXISTS on parents.
create function stock.owner_rollout_allows(o uuid, org uuid) returns boolean
language sql stable as $$
  select coalesce(stock.ctx('role') <> 'franchise_owner', true)
    or stock.ctx('owner_rollout_enforced') is distinct from 'true'
    or (org = stock.ctx_uuid('organization_id') and o is not null and
        o::text = any(string_to_array(coalesce(stock.ctx('owner_outlet_ids'), ''), ',')))
$$;

do $$
declare t record;
begin
  for t in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.columns org
      on org.table_schema=c.table_schema and org.table_name=c.table_name
      and org.column_name='organization_id'
    where c.table_schema in ('stock', 'stock_audit') and c.column_name='outlet_id'
  loop
    execute format('create policy owner_outlet_rollout on %I.%I as restrictive for all to stock_api using (stock.owner_rollout_allows(outlet_id, organization_id)) with check (stock.owner_rollout_allows(outlet_id, organization_id))', t.table_schema, t.table_name);
  end loop;
end $$;
