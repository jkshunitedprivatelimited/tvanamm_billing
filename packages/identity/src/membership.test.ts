import { describe, expect, it } from 'vitest';
import type { Membership, Role } from '@jksh/contracts';
import {
  businessDate,
  businessDateEquals,
  resolveAdminRouting,
  resolveStoreMembership,
} from './membership.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const FR = '00000000-0000-4000-8000-0000000000a1';
const OUT = '00000000-0000-4000-8000-0000000000a2';

let seq = 0;
function membership(role: Role, extra: Partial<Membership> = {}): Membership {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-0000000${String(seq).padStart(5, '0')}`,
    userId: '00000000-0000-4000-8000-000000000009',
    role,
    status: 'active',
    scope: {
      organizationId: ORG,
      ...(role === 'franchise_owner' ? { franchiseId: FR } : {}),
      ...(role === 'store_employee' ? { franchiseId: FR, outletId: OUT } : {}),
    },
    ...extra,
  };
}

describe('resolveAdminRouting', () => {
  it('rejects a store-employee-only user', () => {
    expect(resolveAdminRouting([membership('store_employee')])).toEqual({
      outcome: 'no_admin_access',
    });
  });

  it('routes a single admin membership straight through', () => {
    const result = resolveAdminRouting([membership('central_admin')]);
    expect(result.outcome).toBe('single_workspace');
  });

  it('sends the accountant to the reports workspace', () => {
    const result = resolveAdminRouting([membership('accountant')]);
    expect(result).toMatchObject({ outcome: 'single_workspace', redirectTo: '/reports' });
  });

  it('shows the selector for more than one admin membership', () => {
    const result = resolveAdminRouting([
      membership('franchise_owner'),
      membership('accountant'),
    ]);
    expect(result.outcome).toBe('select_workspace');
  });

  it('ignores suspended memberships', () => {
    const result = resolveAdminRouting([
      membership('central_admin', { status: 'suspended' }),
      membership('franchise_owner'),
    ]);
    expect(result).toMatchObject({ outcome: 'single_workspace' });
  });
});

describe('resolveStoreMembership', () => {
  it('returns the active store membership for the outlet', () => {
    const m = membership('store_employee');
    expect(resolveStoreMembership([m], OUT)?.id).toBe(m.id);
    expect(resolveStoreMembership([m], 'other-outlet')).toBeNull();
  });
});

describe('businessDate', () => {
  it('uses the store IANA zone, not UTC', () => {
    // 20:00 UTC on 3 Sep is 01:30 IST on 4 Sep.
    const instant = new Date('2026-09-03T20:00:00.000Z');
    expect(businessDate(instant, 'Asia/Kolkata')).toEqual({ year: 2026, month: 9, day: 4 });
    expect(businessDate(instant, 'UTC')).toEqual({ year: 2026, month: 9, day: 3 });
  });

  it('compares business dates by value', () => {
    expect(
      businessDateEquals({ year: 2026, month: 9, day: 4 }, { year: 2026, month: 9, day: 4 }),
    ).toBe(true);
  });
});
