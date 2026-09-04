import { describe, expect, it } from 'vitest';
import {
  attemptGate,
  DEFAULT_LOCKOUT_POLICY,
  DUMMY_HASH,
  EMPTY_ATTEMPT_STATE,
  hashPin,
  isValidPinFormat,
  isWeakPin,
  pinLookup,
  pinLookupEquals,
  registerFailure,
  registerSuccess,
  verifyDummyPin,
  verifyPinHash,
} from './pin';
import { verify as argonVerify } from '@node-rs/argon2';

describe('PIN format', () => {
  it('accepts exactly four digits', () => {
    expect(isValidPinFormat('0417')).toBe(true);
    expect(isValidPinFormat('041')).toBe(false);
    expect(isValidPinFormat('04170')).toBe(false);
    expect(isValidPinFormat('abcd')).toBe(false);
  });

  it('flags trivial PINs', () => {
    expect(isWeakPin('0000')).toBe(true);
    expect(isWeakPin('1234')).toBe(true);
    expect(isWeakPin('4321')).toBe(true);
    expect(isWeakPin('0417')).toBe(false);
  });
});

describe('PIN hashing', () => {
  it('verifies a correct PIN and rejects a wrong one', async () => {
    const hash = await hashPin('0417');
    expect(await verifyPinHash(hash, '0417')).toBe(true);
    expect(await verifyPinHash(hash, '0418')).toBe(false);
  });

  it('never returns the same argon2 hash twice', async () => {
    expect(await hashPin('0417')).not.toBe(await hashPin('0417'));
  });
});

describe('timing-equalization dummy hash', () => {
  it('is a well-formed argon2id encoding that decodes without throwing', async () => {
    expect(DUMMY_HASH).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    // A malformed value would throw here; `verifyPinHash` would then swallow it
    // and return early, re-opening the timing side channel.
    await expect(argonVerify(DUMMY_HASH, '9999')).resolves.toBe(false);
  });

  it('spends real argon2 work — comparable to a genuine verification', async () => {
    const realHash = await hashPin('0417');

    const timeOf = async (fn: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await fn();
      return performance.now() - started;
    };

    // Warm up the native addon so the first call does not skew the numbers.
    await verifyDummyPin('1357');
    await verifyPinHash(realHash, '2468');

    const dummyMs = await timeOf(() => verifyDummyPin('1357'));
    const realMs = await timeOf(() => verifyPinHash(realHash, '2468'));

    // The dummy path used to short-circuit in <1ms because the hash could not
    // decode. It must now cost within ~3x of a real verification.
    expect(dummyMs).toBeGreaterThan(realMs / 3);
  });
});

describe('deterministic PIN lookup', () => {
  it('is stable per (secret, outlet, pin) and separates outlets', () => {
    const a = pinLookup('secret-key', 'outlet-1', '0417');
    const b = pinLookup('secret-key', 'outlet-1', '0417');
    const c = pinLookup('secret-key', 'outlet-2', '0417');
    expect(pinLookupEquals(a, b)).toBe(true);
    expect(pinLookupEquals(a, c)).toBe(false);
  });
});

describe('lockout FSM', () => {
  const t0 = new Date('2026-09-03T10:00:00.000Z');

  it('does not throttle below the soft threshold', () => {
    let state = EMPTY_ATTEMPT_STATE;
    state = registerFailure(state, t0);
    state = registerFailure(state, t0);
    expect(state.failedCount).toBe(2);
    expect(attemptGate(state, new Date(t0.getTime() + 1000)).blocked).toBe(false);
  });

  it('imposes a progressive cooldown from the soft threshold', () => {
    let state = EMPTY_ATTEMPT_STATE;
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.softAt; i += 1) {
      state = registerFailure(state, t0);
    }
    const gate = attemptGate(state, new Date(t0.getTime() + 1000));
    expect(gate.blocked).toBe(true);
    expect(gate.retryAfterSeconds).toBe(DEFAULT_LOCKOUT_POLICY.cooldownLadderSeconds[0]! - 1);
  });

  it('clears the cooldown once enough time passes', () => {
    let state = EMPTY_ATTEMPT_STATE;
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.softAt; i += 1) {
      state = registerFailure(state, t0);
    }
    const later = new Date(t0.getTime() + 60_000);
    expect(attemptGate(state, later).blocked).toBe(false);
  });

  it('hard-locks at the hard threshold for the configured duration', () => {
    let state = EMPTY_ATTEMPT_STATE;
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.hardLockAt; i += 1) {
      state = registerFailure(state, t0);
    }
    expect(state.lockedUntil).not.toBeNull();
    const gate = attemptGate(state, new Date(t0.getTime() + 60_000));
    expect(gate.blocked).toBe(true);
    expect(gate.retryAfterSeconds).toBe(DEFAULT_LOCKOUT_POLICY.hardLockSeconds - 60);
    // After the lock window it is clear again.
    expect(
      attemptGate(
        state,
        new Date(t0.getTime() + DEFAULT_LOCKOUT_POLICY.hardLockSeconds * 1000 + 1000),
      ).blocked,
    ).toBe(false);
  });

  it('resets fully on success', () => {
    let state = registerFailure(EMPTY_ATTEMPT_STATE, t0);
    state = registerFailure(state, t0);
    state = registerSuccess();
    expect(state).toEqual(EMPTY_ATTEMPT_STATE);
  });
});
