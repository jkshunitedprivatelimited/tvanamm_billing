import type { Capability } from './capabilities.js';
import type { Role } from './identity.js';

/**
 * Static role -> capability grants for the initial role set
 * (`docs/architecture/billing-actors.md`). This is policy data, not code
 * branching on role names: `authorize()` consumes it, the database seed writes
 * it into `identity.role_permissions`, and admin UIs may read it to shape
 * navigation.
 *
 * Scope still decides *which* resources a capability reaches; these grants only
 * decide whether the verb is available at all.
 */
export const ROLE_CAPABILITIES: Readonly<Record<Role, readonly Capability[]>> = {
  central_admin: [
    'identity.franchise.manage',
    'identity.outlet.manage',
    'identity.user.manage',
    'identity.employee.manage',
    'identity.terminal.enroll',
    'identity.terminal.revoke',
    'identity.session.revoke',
    'identity.audit.read',
    'catalog.menu.manage.master',
    'billing.sale.read.all_stores',
    'billing.report.store',
    'billing.report.global',
    // Explicitly NOT billing.sale.create / discount / refund / void:
    // Central Admin manages outlets but never bills as a Store Employee.
  ],
  accountant: [
    'identity.audit.read',
    'billing.sale.read.all_stores',
    'billing.report.store',
    'billing.report.global',
  ],
  franchise_owner: [
    'identity.outlet.manage',
    'identity.employee.manage',
    'identity.terminal.enroll',
    'identity.terminal.revoke',
    'identity.session.revoke',
    'identity.audit.read',
    'catalog.menu.manage.franchise',
    'catalog.price.configure.outlet',
    'billing.sale.create',
    'billing.sale.read.own_store',
    'billing.discount.apply',
    'billing.sale.void',
    'billing.refund.full',
    'billing.refund.partial',
    'billing.shift.open',
    'billing.shift.close',
    'billing.report.store',
  ],
  store_employee: [
    'billing.sale.create',
    'billing.sale.read.own_store',
    'billing.discount.apply',
    'billing.sale.void',
    'billing.refund.full',
    'billing.refund.partial',
    'billing.shift.open',
    'billing.shift.close',
  ],
};

export function roleGrants(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
