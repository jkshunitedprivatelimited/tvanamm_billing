import type { Capability } from './capabilities.js';
import type { Role } from './identity.js';

/**
 * Role -> capability grants. Policy data, not code branching on role names:
 * `authorize()` consumes it, and `identity.role_capabilities` mirrors the three
 * membership roles (a test asserts equality). `store_employee` is TS-only — it
 * has no membership row; the operator-session path grants this set.
 *
 * Scope still decides *which* resources a capability reaches.
 */
export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = {
  central_admin: [
    'identity.account.manage',
    'identity.employee.manage',
    'identity.terminal.enroll',
    'identity.terminal.revoke',
    'identity.session.revoke',
    'identity.audit.read',
    'billing.outlet.create',
    'billing.outlet.lifecycle',
    'billing.outlet.manage',
    'catalog.menu.manage.master',
    'catalog.menu.publish',
    'billing.sale.read.all_stores',
    'billing.report.store',
    'billing.report.global',
    // Explicitly NOT sale.create / discount / refund / shift / cash: Central
    // manages outlets but never operates as a Store Employee.
  ],
  accountant: [
    'identity.audit.read',
    'billing.sale.read.all_stores',
    'billing.report.store',
    'billing.report.global',
    'billing.accounting.adjust',
  ],
  franchise_owner: [
    'identity.employee.manage',
    'identity.terminal.enroll',
    'identity.terminal.revoke',
    'identity.session.revoke',
    'identity.audit.read',
    'billing.outlet.manage',
    'catalog.menu.manage.franchise',
    'catalog.price.configure.outlet',
    'billing.sale.create',
    'billing.sale.read.own_store',
    'billing.discount.apply',
    'billing.refund.full',
    'billing.refund.partial',
    'billing.shift.open',
    'billing.shift.close',
    'billing.cash_session.open',
    'billing.cash_session.close',
    'billing.report.store',
  ],
  store_employee: [
    'billing.sale.create',
    'billing.sale.read.own_store',
    'billing.discount.apply',
    'billing.refund.full',
    'billing.refund.partial',
    'billing.shift.open',
    'billing.shift.close',
    'billing.cash_session.open',
    'billing.cash_session.close',
  ],
};

export function roleGrants(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
