-- Stage 1 - Reference data. Idempotent. Kept in sync with
-- @jksh/contracts ROLE_CAPABILITIES (an integration test asserts equality).

insert into billing.organizations (id, slug, name) values
  ('01000000-0000-4000-8000-000000000001', 'jksh', 'JKSH United')
on conflict (id) do nothing;

insert into billing.brands (id, organization_id, slug, name, is_billing_enabled) values
  ('01000000-0000-4000-8000-000000000010', '01000000-0000-4000-8000-000000000001', 'tvanamm', 'TVANAMM', true),
  ('01000000-0000-4000-8000-000000000011', '01000000-0000-4000-8000-000000000001', 't-leaf', 'T Leaf', false)
on conflict (id) do nothing;

-- Assignable membership roles (Store Employee is not one).
insert into identity.roles (key, description) values
  ('central_admin',   'Internal JKSH platform administrator'),
  ('accountant',      'Internal JKSH financial read/export and adjustments'),
  ('franchise_owner', 'Tenant administrator for one franchise and its outlets')
on conflict (key) do nothing;

insert into identity.capabilities (key, description) values
  ('identity.account.manage',        'Create franchise-owner and internal accounts and set status'),
  ('identity.employee.manage',       'Create, edit, disable, and reset PINs for store employees'),
  ('identity.terminal.enroll',       'Issue activation codes and enroll terminals'),
  ('identity.terminal.revoke',       'Lock or revoke registered terminals'),
  ('identity.session.revoke',        'Revoke authentication or operator sessions in scope'),
  ('identity.audit.read',            'Read security and financial audit records'),
  ('billing.outlet.create',          'Create an outlet'),
  ('billing.outlet.lifecycle',       'Suspend, close, or reactivate an outlet'),
  ('billing.outlet.manage',          'Configure permitted outlet fields'),
  ('catalog.menu.manage.master',     'Maintain the Central master menu'),
  ('catalog.menu.publish',           'Publish menu versions to outlets'),
  ('catalog.menu.manage.franchise',  'Maintain franchise-owned menu items'),
  ('catalog.price.configure.outlet', 'Configure permitted outlet price and tax settings'),
  ('billing.sale.create',            'Create customer bills'),
  ('billing.sale.read.own_store',    'Read bills for outlets in scope'),
  ('billing.sale.read.all_stores',   'Read bills across all outlets'),
  ('billing.discount.apply',         'Apply discounts up to the remaining bill value'),
  ('billing.refund.full',            'Issue a full refund'),
  ('billing.refund.partial',         'Issue a partial item/quantity refund'),
  ('billing.shift.open',             'Open an employee shift'),
  ('billing.shift.close',            'Close an employee shift'),
  ('billing.cash_session.open',      'Open the shared outlet Cash session'),
  ('billing.cash_session.close',     'Close the shared outlet Cash session'),
  ('billing.report.store',           'Run outlet-scoped reports'),
  ('billing.report.global',          'Run franchise/organization aggregate reports'),
  ('billing.accounting.adjust',      'Create payment-classification / Cash-variance adjustments')
on conflict (key) do nothing;

insert into identity.role_capabilities (role_key, capability_key) values
  ('central_admin', 'identity.account.manage'),
  ('central_admin', 'identity.employee.manage'),
  ('central_admin', 'identity.terminal.enroll'),
  ('central_admin', 'identity.terminal.revoke'),
  ('central_admin', 'identity.session.revoke'),
  ('central_admin', 'identity.audit.read'),
  ('central_admin', 'billing.outlet.create'),
  ('central_admin', 'billing.outlet.lifecycle'),
  ('central_admin', 'billing.outlet.manage'),
  ('central_admin', 'catalog.menu.manage.master'),
  ('central_admin', 'catalog.menu.publish'),
  ('central_admin', 'billing.sale.read.all_stores'),
  ('central_admin', 'billing.report.store'),
  ('central_admin', 'billing.report.global'),

  ('accountant', 'identity.audit.read'),
  ('accountant', 'billing.sale.read.all_stores'),
  ('accountant', 'billing.report.store'),
  ('accountant', 'billing.report.global'),
  ('accountant', 'billing.accounting.adjust'),

  ('franchise_owner', 'identity.employee.manage'),
  ('franchise_owner', 'identity.terminal.enroll'),
  ('franchise_owner', 'identity.terminal.revoke'),
  ('franchise_owner', 'identity.session.revoke'),
  ('franchise_owner', 'identity.audit.read'),
  ('franchise_owner', 'billing.outlet.manage'),
  ('franchise_owner', 'catalog.menu.manage.franchise'),
  ('franchise_owner', 'catalog.price.configure.outlet'),
  ('franchise_owner', 'billing.sale.create'),
  ('franchise_owner', 'billing.sale.read.own_store'),
  ('franchise_owner', 'billing.discount.apply'),
  ('franchise_owner', 'billing.refund.full'),
  ('franchise_owner', 'billing.refund.partial'),
  ('franchise_owner', 'billing.shift.open'),
  ('franchise_owner', 'billing.shift.close'),
  ('franchise_owner', 'billing.cash_session.open'),
  ('franchise_owner', 'billing.cash_session.close'),
  ('franchise_owner', 'billing.report.store')
on conflict (role_key, capability_key) do nothing;
