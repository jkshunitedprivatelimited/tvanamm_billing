-- Stage 1 audit remediation (independent review, 2026-09-04) - close the gaps
-- that migration 0012's MATCH SIMPLE composite foreign keys leave open:
--
--   1. A nullable child `franchise_id` skips the (outlet_id, franchise_id)
--      composite FK entirely, so an employee / terminal / activation code for a
--      franchise-owned outlet could still be inserted with franchise_id = NULL
--      (or a mismatched franchise) via direct SQL.
--   2. billing.franchises(brand_id) had no composite FK proving the brand
--      belongs to the franchise's own organization.

-- ---- 1. Franchise scope must match the parent outlet, NULLs included --------

create or replace function identity.assert_outlet_franchise() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog
as $$
declare
  outlet_franchise uuid;
begin
  select o.franchise_id into outlet_franchise
    from billing.outlets o where o.id = new.outlet_id;

  if not found then
    -- Unknown outlet: let the plain outlet_id foreign key raise the error.
    return new;
  end if;

  if new.franchise_id is distinct from outlet_franchise then
    raise exception
      '% (%): franchise_id % does not match outlet % franchise %',
      tg_argv[0], tg_table_name, new.franchise_id, new.outlet_id, outlet_franchise
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger store_employees_outlet_franchise_match
  before insert or update of outlet_id, franchise_id on identity.store_employees
  for each row execute function
    identity.assert_outlet_franchise('store_employees_outlet_franchise_match');

create trigger terminals_outlet_franchise_match
  before insert or update of outlet_id, franchise_id on identity.terminals
  for each row execute function
    identity.assert_outlet_franchise('terminals_outlet_franchise_match');

create trigger activation_codes_outlet_franchise_match
  before insert or update of outlet_id, franchise_id on identity.terminal_activation_codes
  for each row execute function
    identity.assert_outlet_franchise('activation_codes_outlet_franchise_match');

-- ---- 2. A franchise's brand must belong to the franchise's organization ----

alter table billing.franchises
  add constraint franchises_brand_org_fk
  foreign key (brand_id, organization_id) references billing.brands(id, organization_id);
