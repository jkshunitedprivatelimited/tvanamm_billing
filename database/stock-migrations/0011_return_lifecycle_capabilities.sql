-- Closes the self-approval gap in the owner-return workflow (0010 rewrite):
-- a Franchise Owner could previously approve their own return and value its
-- credit. Splits that single "approve" step into approve / collect / receive
-- so a different party (Central or warehouse) performs each one, and revokes
-- the owner's approve grant. 0001 already seeded the pre-split capability
-- table on the deployed project, so this patches it forward rather than
-- editing that migration in place.

insert into stock.capabilities (code, description) values
  ('stock.return.collect', 'Confirm a return was physically collected from an outlet'),
  ('stock.return.receive', 'Inspect a collected return and finalize credit/replace/reject')
on conflict (code) do nothing;

-- central_admin holds every capability by convention.
insert into stock.role_capabilities (role, capability)
select 'central_admin'::stock.actor_role, code
from stock.capabilities
where code in ('stock.return.collect', 'stock.return.receive')
on conflict do nothing;

insert into stock.role_capabilities (role, capability) values
  ('warehouse_manager', 'stock.return.collect'),
  ('warehouse_manager', 'stock.return.receive'),
  ('warehouse_staff', 'stock.return.collect')
on conflict do nothing;

-- The requesting party can no longer approve its own request.
delete from stock.role_capabilities
 where role = 'franchise_owner' and capability = 'stock.return.approve';
