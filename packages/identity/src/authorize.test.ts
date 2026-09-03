import { describe, expect, it } from 'vitest';
import type { ActorContext, Capability } from '@jksh/contracts';
import { authorize, scopeContains } from './authorize.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const FR_A = '00000000-0000-4000-8000-0000000000a1';
const FR_B = '00000000-0000-4000-8000-0000000000b1';
const OUT_A1 = '00000000-0000-4000-8000-0000000000a2';
const OUT_A2 = '00000000-0000-4000-8000-0000000000a3';

function admin(role: ActorContext['role'], scope: ActorContext['scope']): ActorContext {
  return { kind: 'admin', accountId: ORG, accountStatus: 'active', role, scope, sessionActive: true };
}

describe('scopeContains', () => {
  it('org-only covers any franchise/outlet in the org', () => {
    expect(scopeContains({ organizationId: ORG }, { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 })).toBe(true);
  });
  it('franchise scope rejects another franchise', () => {
    expect(scopeContains({ organizationId: ORG, franchiseId: FR_A }, { organizationId: ORG, franchiseId: FR_B })).toBe(false);
  });
  it('outlet scope matches only that outlet', () => {
    const m = { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 };
    expect(scopeContains(m, m)).toBe(true);
    expect(scopeContains(m, { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A2 })).toBe(false);
  });
});

describe('authorize - capability matrix', () => {
  const cases: { role: ActorContext['role']; allow: Capability[]; deny: Capability[] }[] = [
    { role: 'central_admin', allow: ['billing.outlet.create', 'billing.outlet.lifecycle', 'catalog.menu.publish'], deny: ['billing.sale.create', 'billing.refund.full', 'billing.discount.apply'] },
    { role: 'accountant', allow: ['billing.report.global', 'billing.accounting.adjust', 'identity.audit.read'], deny: ['billing.sale.create', 'identity.employee.manage', 'billing.outlet.create'] },
    { role: 'franchise_owner', allow: ['identity.employee.manage', 'billing.refund.partial', 'billing.outlet.manage'], deny: ['billing.outlet.create', 'billing.outlet.lifecycle', 'catalog.menu.manage.master'] },
    { role: 'store_employee', allow: ['billing.sale.create', 'billing.cash_session.close', 'billing.shift.open'], deny: ['billing.report.global', 'identity.employee.manage', 'billing.outlet.manage'] },
  ];
  for (const { role, allow, deny } of cases) {
    const scope =
      role === 'store_employee'
        ? { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 }
        : role === 'franchise_owner'
          ? { organizationId: ORG, franchiseId: FR_A }
          : { organizationId: ORG };
    const requested = { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 };
    const actor: ActorContext =
      role === 'store_employee'
        ? { kind: 'operator', employeeId: ORG, role, scope, sessionActive: true, outletId: OUT_A1 }
        : admin(role, scope);
    for (const cap of allow) {
      it(`${role} allowed ${cap}`, () => { expect(authorize(actor, cap, requested).allowed).toBe(true); });
    }
    for (const cap of deny) {
      it(`${role} denied ${cap}`, () => { expect(authorize(actor, cap, requested).allowed).toBe(false); });
    }
  }
});

describe('authorize - gate clauses', () => {
  const scope = { organizationId: ORG, franchiseId: FR_A };
  it('denies an inactive admin account', () => {
    const actor = { ...admin('franchise_owner', scope), accountStatus: 'suspended' as const };
    expect(authorize(actor, 'identity.employee.manage', scope)).toEqual({ allowed: false, reason: 'account_inactive' });
  });
  it('denies out-of-scope', () => {
    expect(authorize(admin('franchise_owner', scope), 'identity.employee.manage', { organizationId: ORG, franchiseId: FR_B })).toEqual({
      allowed: false,
      reason: 'out_of_scope',
    });
  });
  it('requires fresh auth when the policy demands it', () => {
    const base = admin('franchise_owner', scope);
    expect(authorize(base, 'identity.employee.manage', scope, { requireFreshAuthWithinSeconds: 300 })).toEqual({
      allowed: false,
      reason: 'fresh_auth_required',
    });
    expect(authorize({ ...base, secondsSinceAuth: 60 }, 'identity.employee.manage', scope, { requireFreshAuthWithinSeconds: 300 }).allowed).toBe(true);
  });
});
