-- Stage 1 audit remediation (independent review round 3, 2026-09-04) - close the
-- last direct-SQL paths around tenant scope that migrations 0012 / 0013 left
-- open.

-- ---- 1. Outlet tenant scope is immutable after creation --------------------
-- 0013's child triggers fire only on child writes, and the MATCH SIMPLE
-- composite foreign keys ignore a pre-existing NULL child franchise_id. So a
-- jksh_owned outlet could collect NULL-franchise employees / terminals /
-- activation codes and *then* be switched to franchise_owned with a real
-- franchise. Nothing in the application ever repoints an outlet's organization,
-- brand, franchise, or ownership type (only status and config columns change),
-- so freeze them.

create or replace function billing.freeze_outlet_scope() returns trigger
  language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.brand_id is distinct from old.brand_id
     or new.franchise_id is distinct from old.franchise_id
     or new.ownership_type is distinct from old.ownership_type then
    raise exception
      'outlets_scope_frozen: organization_id / brand_id / franchise_id / ownership_type are immutable after creation (outlet %)',
      old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger outlets_freeze_scope
  before update of organization_id, brand_id, franchise_id, ownership_type
  on billing.outlets
  for each row execute function billing.freeze_outlet_scope();

-- ---- 2. An outlet's brand must belong to the outlet's organization --------
-- Completes the organization chain: brand -> org and (0012) franchise -> brand
-- already hold, so a franchise-owned outlet's whole scope is now consistent.

alter table billing.outlets
  add constraint outlets_brand_org_fk
  foreign key (brand_id, organization_id) references billing.brands(id, organization_id);

-- ---- 3. A Franchise Owner membership must name its brand -----------------
-- Backfill any legacy rows from the franchise, then require brand_id so a
-- direct insert cannot leave it NULL and slip past 0012's MATCH SIMPLE
-- memberships_franchise_brand_fk.

update identity.memberships m
   set brand_id = f.brand_id
  from billing.franchises f
 where m.franchise_id = f.id
   and m.franchise_id is not null
   and m.brand_id is null;

alter table identity.memberships drop constraint memberships_scope_shape;
alter table identity.memberships add constraint memberships_scope_shape check (
  case role_key
    when 'central_admin'   then franchise_id is null and outlet_id is null
    when 'accountant'      then franchise_id is null and outlet_id is null
    when 'franchise_owner' then franchise_id is not null and brand_id is not null
    else false
  end
);
