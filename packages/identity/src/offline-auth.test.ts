import { describe, expect, it } from 'vitest';
import {
  assertOfflineAuthCovers,
  DEFAULT_OFFLINE_DISCOUNT_POLICY,
  mintOfflineAuthBundle,
  OFFLINE_AUTH_HOURS,
  parseOfflineAuthBundle,
} from './offline-auth';

const SECRET = 'test-offline-auth-secret-0123456789';
const now = new Date('2026-09-05T10:00:00.000Z');

function issue() {
  return mintOfflineAuthBundle(
    SECRET,
    {
      organizationId: 'org-1',
      outletId: 'outlet-1',
      terminalId: 'terminal-1',
      employeeIds: ['emp-1', 'emp-2'],
      menuVersion: '4',
      menuChecksum: 'checksum-4',
    },
    now,
  );
}

function claimAt(
  offsetMs: number,
  overrides: Partial<Parameters<typeof assertOfflineAuthCovers>[1]> = {},
) {
  return {
    outletId: 'outlet-1',
    terminalId: 'terminal-1',
    employeeId: 'emp-1',
    menuVersion: '4',
    menuChecksum: 'checksum-4',
    terminalOccurredAt: new Date(now.getTime() + offsetMs).toISOString(),
    ...overrides,
  };
}

describe('offline authorization bundle', () => {
  it('round-trips and is valid for exactly 24 hours', () => {
    const { token, bundle } = issue();
    const parsed = parseOfflineAuthBundle(SECRET, token);
    expect(parsed).toEqual(bundle);
    expect(bundle.discountPolicy).toEqual(DEFAULT_OFFLINE_DISCOUNT_POLICY);
    expect(new Date(bundle.expiresAt).getTime() - new Date(bundle.issuedAt).getTime()).toBe(
      OFFLINE_AUTH_HOURS * 3_600_000,
    );
  });

  it('rejects a tampered token or the wrong secret', () => {
    const { token } = issue();
    expect(parseOfflineAuthBundle(SECRET, token.slice(0, -2) + 'xx')).toBeNull();
    expect(parseOfflineAuthBundle('a-different-secret-value-here', token)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(parseOfflineAuthBundle(SECRET, 'not-a-token')).toBeNull();
    expect(parseOfflineAuthBundle(SECRET, 'jksh_off_v1.onlyonepart')).toBeNull();
  });

  it('covers any permitted employee from the same terminal, inside the window', () => {
    const { bundle } = issue();
    expect(assertOfflineAuthCovers(bundle, claimAt(10 * 3_600_000))).toEqual({ ok: true });
    expect(
      assertOfflineAuthCovers(bundle, claimAt(10 * 3_600_000, { employeeId: 'emp-2' })),
    ).toEqual({ ok: true });
  });

  it('rejects an employee not on the permitted list', () => {
    const { bundle } = issue();
    expect(
      assertOfflineAuthCovers(bundle, claimAt(1 * 3_600_000, { employeeId: 'emp-9' })).ok,
    ).toBe(false);
  });

  it('rejects a different terminal', () => {
    const { bundle } = issue();
    expect(
      assertOfflineAuthCovers(bundle, claimAt(1 * 3_600_000, { terminalId: 'terminal-2' })).ok,
    ).toBe(false);
  });

  it('rejects a menu version/checksum that does not match what was signed', () => {
    const { bundle } = issue();
    expect(assertOfflineAuthCovers(bundle, claimAt(1 * 3_600_000, { menuVersion: '5' })).ok).toBe(
      false,
    );
    expect(
      assertOfflineAuthCovers(bundle, claimAt(1 * 3_600_000, { menuChecksum: 'tampered' })).ok,
    ).toBe(false);
  });

  it('rejects a claimed time before issuance or past the 24h window', () => {
    const { bundle } = issue();
    expect(assertOfflineAuthCovers(bundle, claimAt(-1000)).ok).toBe(false);
    expect(assertOfflineAuthCovers(bundle, claimAt((OFFLINE_AUTH_HOURS + 1) * 3_600_000)).ok).toBe(
      false,
    );
  });
});
