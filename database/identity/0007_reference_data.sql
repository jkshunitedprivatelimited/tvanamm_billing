-- Stage 1 - Reference data. Idempotent. Kept in sync with
-- @jksh/contracts ROLE_CAPABILITIES (an integration test asserts equality).

-- Organization and brands (docs/architecture/platform-decisions.md).
insert into identity.organizations (id, slug, name) values
  ('01000000-0000-4000-8000-000000000001', 'jksh', 'JKSH United')
on conflict (id) do nothing;

insert into identity.brands (id, organization_id, slug, name, is_billing_enabled) values
  ('01000000-0000-4000-8000-000000000010', '01000000-0000-4000-8000-000000000001', 'tvanamm', 'TVANAMM', true),
  ('01000000-0000-4000-8000-000000000011', '01000000-0000-4000-8000-000000000001', 't-leaf', 'T Leaf', false)
on conflict (id) do nothing;

-- Roles.
insert into identity.roles (key, description) values
  ('central_admin',   'Internal JKSH platform administrator'),
  ('accountant',      'Internal JKSH financial read/export and adjustments'),
  ('franchise_owner', 'Tenant administrator for one franchise and its outlets'),
  ('store_employee',  'Outlet operator for one assigned outlet')
on conflict (key) do nothing;

-- Permissions (mirror of @jksh/contracts capabilitySchema).
insert into identity.permissions (key, description) values
  ('identity.franchise.manage',        'Create and manage franchise customers'),
  ('identity.outlet.manage',           'Create and manage outlets in scope'),
  ('identity.user.manage',             'Create, disable, and support user accounts'),
  ('identity.employee.manage',         'Create store employees and manage their PINs'),
  ('identity.terminal.enroll',         'Issue activation codes and enroll terminals'),
  ('identity.terminal.revoke',         'Lock or revoke registered terminals'),
  ('identity.session.revoke',          'Revoke authentication sessions in scope'),
  ('identity.audit.read',              'Read security and financial audit records'),
  ('catalog.menu.manage.master',       'Maintain the Central master menu'),
  ('catalog.menu.manage.franchise',    'Maintain franchise-owned menu items'),
  ('catalog.price.configure.outlet',   'Configure permitted outlet price and tax settings'),
  ('billing.sale.create',              'Create customer bills'),
  ('billing.sale.read.own_store',      'Read bills for outlets in scope'),
  ('billing.sale.read.all_stores',     'Read bills across all outlets'),
  ('billing.discount.apply',           'Apply discounts up to the remaining bill value'),
  ('billing.price.override',           'Override the catalog selling price'),
  ('billing.sale.void',                'Void a bill where permitted'),
  ('billing.refund.full',              'Issue a full refund'),
  ('billing.refund.partial',           'Issue a partial item/quantity refund'),
  ('billing.refund.approve',           'Approve a refund that requires approval'),
  ('billing.shift.open',               'Open an employee shift'),
  ('billing.shift.close',              'Close an employee shift'),
  ('billing.report.store',             'Run outlet-scoped reports'),
  ('billing.report.global',            'Run franchise/organization aggregate reports')
on conflict (key) do nothing;

-- Role -> permission grants.
insert into identity.role_permissions (role_key, permission_key) values
  ('central_admin', 'identity.franchise.manage'),
  ('central_admin', 'identity.outlet.manage'),
  ('central_admin', 'identity.user.manage'),
  ('central_admin', 'identity.employee.manage'),
  ('central_admin', 'identity.terminal.enroll'),
  ('central_admin', 'identity.terminal.revoke'),
  ('central_admin', 'identity.session.revoke'),
  ('central_admin', 'identity.audit.read'),
  ('central_admin', 'catalog.menu.manage.master'),
  ('central_admin', 'billing.sale.read.all_stores'),
  ('central_admin', 'billing.report.store'),
  ('central_admin', 'billing.report.global'),

  ('accountant', 'identity.audit.read'),
  ('accountant', 'billing.sale.read.all_stores'),
  ('accountant', 'billing.report.store'),
  ('accountant', 'billing.report.global'),

  ('franchise_owner', 'identity.outlet.manage'),
  ('franchise_owner', 'identity.employee.manage'),
  ('franchise_owner', 'identity.terminal.enroll'),
  ('franchise_owner', 'identity.terminal.revoke'),
  ('franchise_owner', 'identity.session.revoke'),
  ('franchise_owner', 'identity.audit.read'),
  ('franchise_owner', 'catalog.menu.manage.franchise'),
  ('franchise_owner', 'catalog.price.configure.outlet'),
  ('franchise_owner', 'billing.sale.create'),
  ('franchise_owner', 'billing.sale.read.own_store'),
  ('franchise_owner', 'billing.discount.apply'),
  ('franchise_owner', 'billing.sale.void'),
  ('franchise_owner', 'billing.refund.full'),
  ('franchise_owner', 'billing.refund.partial'),
  ('franchise_owner', 'billing.shift.open'),
  ('franchise_owner', 'billing.shift.close'),
  ('franchise_owner', 'billing.report.store'),

  ('store_employee', 'billing.sale.create'),
  ('store_employee', 'billing.sale.read.own_store'),
  ('store_employee', 'billing.discount.apply'),
  ('store_employee', 'billing.sale.void'),
  ('store_employee', 'billing.refund.full'),
  ('store_employee', 'billing.refund.partial'),
  ('store_employee', 'billing.shift.open'),
  ('store_employee', 'billing.shift.close')
on conflict (role_key, permission_key) do nothing;
