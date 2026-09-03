import { describe, expect, it } from 'vitest';
import type { ActorContext, Capability, Role } from '@jksh/contracts';
import { authorize, scopeContains } from './authorize.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const FR_A = '00000000-0000-4000-8000-0000000000a1';
const FR_B = '00000000-0000-4000-8000-0000000000b1';
const OUT_A1 = '00000000-0000-4000-8000-0000000000a2';
const OUT_A2 = '00000000-0000-4000-8000-0000000000a3';

function actor(
  role: Role,
  scope: ActorContext['membership']['scope'],
  overrides: Partial<ActorContext> = {},
): ActorContext {
  return {
    userId: '00000000-0000-4000-8000-000000000009',
    accountState: 'active',
    sessionId: '00000000-0000-4000-8000-00000000000a',
    sessionActive: true,
    membership: {
      id: '00000000-0000-4000-8000-00000000000b',
      userId: '00000000-0000-4000-8000-000000000009',
      role,
      status: 'active',
      scope,
    },
    ...overrides,
  };
}

describe('scopeContains', () => {
  it('org-only membership covers any franchise/outlet in the org', () => {
    expect(
      scopeContains(
        { organizationId: ORG },
        { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 },
      ),
    ).toBe(true);
  });

  it('franchise membership rejects another franchise', () => {
    expect(
      scopeContains(
        { organizationId: ORG, franchiseId: FR_A },
        { organizationId: ORG, franchiseId: FR_B },
      ),
    ).toBe(false);
  });

  it('outlet membership matches only that outlet', () => {
    const m = { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 };
    expect(scopeContains(m, m)).toBe(true);
    expect(
      scopeContains(m, { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A2 }),
    ).toBe(false);
  });

  it('rejects a different organization', () => {
    expect(
      scopeContains({ organizationId: ORG }, { organizationId: FR_A }),
    ).toBe(false);
  });
});

describe('authorize - capability matrix', () => {
  const cases: { role: Role; allow: Capability[]; deny: Capability[] }[] = [
    {
      role: 'central_admin',
      allow: ['identity.franchise.manage', 'billing.report.global', 'identity.terminal.enroll'],
      deny: ['billing.sale.create', 'billing.refund.full', 'billing.discount.apply'],
    },
    {
      role: 'accountant',
      allow: ['billing.report.global', 'billing.sale.read.all_stores', 'identity.audit.read'],
      deny: ['billing.sale.create', 'identity.employee.manage', 'billing.refund.partial'],
    },
    {
      role: 'franchise_owner',
      allow: ['identity.employee.manage', 'billing.refund.partial', 'catalog.price.configure.outlet'],
      deny: ['billing.report.global', 'catalog.menu.manage.master', 'identity.franchise.manage'],
    },
    {
      role: 'store_employee',
      allow: ['billing.sale.create', 'billing.discount.apply', 'billing.shift.open'],
      deny: ['billing.report.global', 'identity.employee.manage', 'catalog.price.configure.outlet'],
    },
  ];

  for (const { role, allow, deny } of cases) {
    const scope =
      role === 'store_employee'
        ? { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 }
        : role === 'franchise_owner'
          ? { organizationId: ORG, franchiseId: FR_A }
          : { organizationId: ORG };
    const requested = { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 };

    for (const cap of allow) {
      it(`${role} is allowed ${cap}`, () => {
        expect(authorize(actor(role, scope), cap, requested).allowed).toBe(true);
      });
    }
    for (const cap of deny) {
      it(`${role} is denied ${cap}`, () => {
        const decision = authorize(actor(role, scope), cap, requested);
        expect(decision.allowed).toBe(false);
      });
    }
  }
});

describe('authorize - gate clauses', () => {
  const scope = { organizationId: ORG, franchiseId: FR_A, outletId: OUT_A1 };
  const requested = scope;

  it('denies an inactive session', () => {
    const decision = authorize(
      actor('store_employee', scope, { sessionActive: false }),
      'billing.sale.create',
      requested,
    );
    expect(decision).toEqual({ allowed: false, reason: 'session_inactive' });
  });

  it('denies a disabled account', () => {
    const decision = authorize(
      actor('store_employee', scope, { accountState: 'disabled' }),
      'billing.sale.create',
      requested,
    );
    expect(decision).toEqual({ allowed: false, reason: 'account_inactive' });
  });

  it('denies out-of-scope outlets', () => {
    const decision = authorize(actor('store_employee', scope), 'billing.sale.create', {
      organizationId: ORG,
      franchiseId: FR_A,
      outletId: OUT_A2,
    });
    expect(decision).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('requires step-up when policy demands recent MFA', () => {
    const base = actor('franchise_owner', { organizationId: ORG, franchiseId: FR_A });
    expect(
      authorize(base, 'billing.refund.full', { organizationId: ORG, franchiseId: FR_A }, {
        requireStepUpWithinSeconds: 300,
      }),
    ).toEqual({ allowed: false, reason: 'step_up_required' });
    expect(
      authorize(
        { ...base, secondsSinceStepUp: 120 },
        'billing.refund.full',
        { organizationId: ORG, franchiseId: FR_A },
        { requireStepUpWithinSeconds: 300 },
      ).allowed,
    ).toBe(true);
  });

  it('requires an open shift when policy demands it', () => {
    const decision = authorize(
      actor('store_employee', scope),
      'billing.sale.create',
      requested,
      { requireOpenShift: true },
    );
    expect(decision).toEqual({ allowed: false, reason: 'shift_required' });
  });

  it('requires the terminal outlet to match', () => {
    const withTerminal = actor('store_employee', scope, {
      terminalId: '00000000-0000-4000-8000-0000000000cc',
      outletId: OUT_A1,
    });
    expect(
      authorize(withTerminal, 'billing.sale.create', requested, {
        requireTerminalOutlet: OUT_A1,
      }).allowed,
    ).toBe(true);
    expect(
      authorize(withTerminal, 'billing.sale.create', requested, {
        requireTerminalOutlet: OUT_A2,
      }),
    ).toEqual({ allowed: false, reason: 'terminal_context_required' });
  });
});
