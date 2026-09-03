import { z } from 'zod';

/**
 * The full capability registry. Authorization checks a capability plus a
 * resource scope; it never branches on a role name directly
 * (`docs/checklists/billing-system.md` section 4).
 *
 * Stage 1 exercises the identity.* and report/read capabilities. The billing.*
 * and catalog.* capabilities are declared now so the matrix and its tests are
 * complete, and later stages only wire UI and handlers to them.
 */
export const capabilitySchema = z.enum([
  // Identity and tenant administration
  'identity.franchise.manage',
  'identity.outlet.manage',
  'identity.user.manage',
  'identity.employee.manage',
  'identity.terminal.enroll',
  'identity.terminal.revoke',
  'identity.session.revoke',
  'identity.audit.read',

  // Catalog (Stage 2)
  'catalog.menu.manage.master',
  'catalog.menu.manage.franchise',
  'catalog.price.configure.outlet',

  // Billing (Stage 3+)
  'billing.sale.create',
  'billing.sale.read.own_store',
  'billing.sale.read.all_stores',
  'billing.discount.apply',
  'billing.price.override',
  'billing.sale.void',
  'billing.refund.full',
  'billing.refund.partial',
  'billing.refund.approve',
  'billing.shift.open',
  'billing.shift.close',

  // Reporting (Stage 6)
  'billing.report.store',
  'billing.report.global',
]);

export type Capability = z.infer<typeof capabilitySchema>;
