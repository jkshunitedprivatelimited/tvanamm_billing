import type { Capability } from './capabilities';
import type { Role } from './identity';

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
    'billing.franchise.manage',
    'billing.outlet.create',
    'billing.outlet.lifecycle',
    'billing.outlet.manage',
    'catalog.menu.manage.master',
    'catalog.menu.publish',
    'catalog.item.pause',
    'catalog.tax_profile.manage',
    'billing.sale.read.all_stores',
    'billing.report.store',
    'billing.report.global',
    'identity.attendance.oversee',
    'identity.attendance.schedule_manage',
    // Explicitly NOT sale.create / discount / refund / shift / cash: Central
    // manages outlets but never operates as a Store Employee.
  ],
  accountant: [
    'identity.audit.read',
    'billing.sale.read.all_stores',
    'billing.report.store',
    'billing.report.global',
    'billing.accounting.adjust',
    // Explicitly no attendance capability - "no attendance-management
    // capability by default" (`workforce-attendance.md`).
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
    'catalog.item.pause',
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
    'identity.attendance.oversee',
  ],
  store_employee: [
    'catalog.item.pause',
    'billing.sale.create',
    'billing.sale.read.own_store',
    'billing.discount.apply',
    'billing.refund.full',
    'billing.refund.partial',
    'billing.shift.open',
    'billing.shift.close',
    'billing.cash_session.open',
    'billing.cash_session.close',
    'identity.attendance.self',
  ],
};

export function roleGrants(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
