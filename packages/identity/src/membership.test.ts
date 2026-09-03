import { describe, expect, it } from 'vitest';
import type { MembershipRole } from '@jksh/contracts';
import {
  businessDate,
  businessDateEquals,
  resolveAdminRouting,
  type MembershipRow,
} from './membership';

const ORG = '00000000-0000-4000-8000-000000000001';
let seq = 0;
function m(role: MembershipRole, status: MembershipRow['status'] = 'active'): MembershipRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-0000000${String(seq).padStart(5, '0')}`,
    role,
    status,
    organizationId: ORG,
    brandId: null,
    franchiseId: role === 'franchise_owner' ? '00000000-0000-4000-8000-0000000000a1' : null,
  };
}

describe('resolveAdminRouting', () => {
  it('rejects when there is no usable membership', () => {
    expect(resolveAdminRouting([m('central_admin', 'suspended')])).toEqual({
      outcome: 'no_admin_access',
    });
  });
  it('routes a single membership straight through', () => {
    expect(resolveAdminRouting([m('central_admin')]).outcome).toBe('single_workspace');
  });
  it('sends the accountant to /reports', () => {
    expect(resolveAdminRouting([m('accountant')])).toMatchObject({
      outcome: 'single_workspace',
      redirectTo: '/reports',
    });
  });
  it('shows the selector for more than one', () => {
    expect(resolveAdminRouting([m('central_admin'), m('accountant')]).outcome).toBe(
      'select_workspace',
    );
  });
});

describe('businessDate', () => {
  it('uses the store IANA zone, not UTC', () => {
    const instant = new Date('2026-09-03T20:00:00.000Z');
    expect(businessDate(instant, 'Asia/Kolkata')).toEqual({ year: 2026, month: 9, day: 4 });
    expect(businessDate(instant, 'UTC')).toEqual({ year: 2026, month: 9, day: 3 });
  });
  it('compares by value', () => {
    expect(
      businessDateEquals({ year: 2026, month: 9, day: 4 }, { year: 2026, month: 9, day: 4 }),
    ).toBe(true);
  });
});
