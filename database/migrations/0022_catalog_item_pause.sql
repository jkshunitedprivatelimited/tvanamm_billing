-- Employee active-outlet item pause (`docs/architecture/menu-publishing.md`
-- "Employee active-outlet pause, owner scoped pause, and Central global
-- oversight"). store_employee has no membership row, so it is granted only in
-- the TS `ROLE_CAPABILITIES` map, not mirrored here.

insert into identity.capabilities (key, description) values
  ('catalog.item.pause', 'Pause/unpause an outlet item for sale without editing name, price, or GST')
on conflict (key) do nothing;

insert into identity.role_capabilities (role_key, capability_key) values
  ('central_admin', 'catalog.item.pause'),
  ('franchise_owner', 'catalog.item.pause')
on conflict (role_key, capability_key) do nothing;
