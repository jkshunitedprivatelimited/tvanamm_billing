import { describe, expect, it } from 'vitest';
import { activationClientKey, ACTIVATION_LOCKOUT_POLICY } from './activation-attempts';
import { attemptGate, registerFailure, type AttemptState } from './pin';

describe('activationClientKey', () => {
  it('is a stable, non-reversible per-IP bucket', () => {
    const a = activationClientKey('203.0.113.7');
    const b = activationClientKey('203.0.113.7');
    const c = activationClientKey('203.0.113.8');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(a).not.toContain('203.0.113.7');
  });

  it('falls back to a single shared bucket without an IP', () => {
    expect(activationClientKey(undefined)).toBe('global');
    expect(activationClientKey('')).toBe('global');
  });
});

describe('activation lockout policy', () => {
  const t0 = new Date('2026-09-04T10:00:00.000Z');

  it('does not throttle the first couple of failures', () => {
    let s: AttemptState = { failedCount: 0, lastFailedAt: null, lockedUntil: null };
    s = registerFailure(s, t0, ACTIVATION_LOCKOUT_POLICY);
    s = registerFailure(s, t0, ACTIVATION_LOCKOUT_POLICY);
    expect(attemptGate(s, new Date(t0.getTime() + 1000), ACTIVATION_LOCKOUT_POLICY).blocked).toBe(
      false,
    );
  });

  it('imposes a cooldown from the soft threshold and hard-locks at the ceiling', () => {
    let s: AttemptState = { failedCount: 0, lastFailedAt: null, lockedUntil: null };
    for (let i = 0; i < ACTIVATION_LOCKOUT_POLICY.softAt; i += 1) {
      s = registerFailure(s, t0, ACTIVATION_LOCKOUT_POLICY);
    }
    expect(attemptGate(s, new Date(t0.getTime() + 1000), ACTIVATION_LOCKOUT_POLICY).blocked).toBe(
      true,
    );

    for (
      let i = ACTIVATION_LOCKOUT_POLICY.softAt;
      i < ACTIVATION_LOCKOUT_POLICY.hardLockAt;
      i += 1
    ) {
      s = registerFailure(s, t0, ACTIVATION_LOCKOUT_POLICY);
    }
    const gate = attemptGate(s, new Date(t0.getTime() + 60_000), ACTIVATION_LOCKOUT_POLICY);
    expect(gate.blocked).toBe(true);
    expect(gate.retryAfterSeconds).toBe(ACTIVATION_LOCKOUT_POLICY.hardLockSeconds - 60);
  });
});
