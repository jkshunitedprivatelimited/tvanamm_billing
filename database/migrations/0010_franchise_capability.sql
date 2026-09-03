-- Stage 1 audit remediation (P1) - Central-only franchise management capability.

insert into identity.capabilities (key, description) values
  ('billing.franchise.manage', 'Create and manage franchises')
on conflict (key) do nothing;

insert into identity.role_capabilities (role_key, capability_key) values
  ('central_admin', 'billing.franchise.manage')
on conflict (role_key, capability_key) do nothing;
