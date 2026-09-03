import { z } from 'zod';

/**
 * The capability registry. Authorization checks a capability + a resource scope;
 * it never branches on a role name directly (`docs/checklists/billing-system.md`
 * §4). Kept in sync with `identity.capabilities` (a test asserts equality).
 */
export const capabilitySchema = z.enum([
  // Identity and account administration
  'identity.account.manage',
  'identity.employee.manage',
  'identity.terminal.enroll',
  'identity.terminal.revoke',
  'identity.session.revoke',
  'identity.audit.read',

  // Outlet lifecycle and configuration
  'billing.outlet.create',
  'billing.outlet.lifecycle',
  'billing.outlet.manage',

  // Catalog (Stage 2)
  'catalog.menu.manage.master',
  'catalog.menu.publish',
  'catalog.menu.manage.franchise',
  'catalog.price.configure.outlet',

  // Billing (Stage 3+)
  'billing.sale.create',
  'billing.sale.read.own_store',
  'billing.sale.read.all_stores',
  'billing.discount.apply',
  'billing.refund.full',
  'billing.refund.partial',
  'billing.shift.open',
  'billing.shift.close',
  'billing.cash_session.open',
  'billing.cash_session.close',

  // Reporting and accounting (Stage 6)
  'billing.report.store',
  'billing.report.global',
  'billing.accounting.adjust',
]);

export type Capability = z.infer<typeof capabilitySchema>;
