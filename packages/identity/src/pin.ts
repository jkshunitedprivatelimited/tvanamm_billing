import { createHmac, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

export const PIN_PATTERN = /^\d{4}$/;

const TRIVIAL_PINS = new Set([
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  '1234',
  '2345',
  '3456',
  '4567',
  '5678',
  '6789',
  '0123',
  '9876',
  '8765',
  '7654',
  '6543',
  '5432',
  '4321',
  '3210',
]);

export function isValidPinFormat(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** Reject obvious PINs. Store Employees have no discount ceiling, so a stolen
 *  PIN is high value; block the easy guesses. */
export function isWeakPin(pin: string): boolean {
  return TRIVIAL_PINS.has(pin);
}

// --- Hashing ---------------------------------------------------------------

const ARGON_OPTS = {
  // OWASP-ish parameters for a short secret; tuned for ~50-100ms on server HW.
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPin(pin: string): Promise<string> {
  return argonHash(pin, ARGON_OPTS);
}

export async function verifyPinHash(hashValue: string, pin: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, pin);
  } catch {
    return false;
  }
}

// A real argon2id hash (of a fixed non-PIN string, generated with ARGON_OPTS)
// used to spend the same CPU as a genuine verification when no employee
// matches, so a caller cannot distinguish "unknown PIN" from "wrong PIN" by
// timing. It MUST decode and execute — a malformed value would make
// `argonVerify` throw and return early, re-opening the side channel — so
// `pin.test.ts` asserts `verifyDummyPin` actually runs argon2. Never equal to
// any real PIN hash (the input is not four digits).
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$FDJfDPYEWWPtZoo9gXYM5Q$u4n/FFfwjAZf3FuYZvLMXTS7XPjqpPtHmccOKPEFiqg';

/** Constant-ish-time no-op verification for the "no matching employee" path.
 *  Only the CPU time spent matters; the boolean result (always false) is
 *  discarded by callers. */
export async function verifyDummyPin(pin: string): Promise<void> {
  await verifyPinHash(DUMMY_HASH, pin);
}

/**
 * Deterministic, keyed lookup hash. Enables outlet-local PIN uniqueness and a
 * single-row lookup at login without scanning every argon2 hash in the outlet.
 * Not a substitute for the argon2 verification that follows.
 */
export function pinLookup(secret: string, outletId: string, pin: string): Buffer {
  return createHmac('sha256', secret).update(`${outletId}:${pin}`).digest();
}

export function pinLookupEquals(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Throttle / lockout FSM ---------------------------------------------------

export interface AttemptState {
  failedCount: number;
  lastFailedAt: Date | null;
  lockedUntil: Date | null;
}

export interface LockoutPolicy {
  /** Consecutive failures at/after which each attempt gets a cooldown. */
  softAt: number;
  /** Cooldown seconds by failure count once past `softAt` (last entry repeats). */
  cooldownLadderSeconds: number[];
  /** Consecutive failures at/after which the account/terminal is hard-locked. */
  hardLockAt: number;
  /** Hard-lock duration in seconds. */
  hardLockSeconds: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  softAt: 3,
  cooldownLadderSeconds: [15, 30, 60, 120],
  hardLockAt: 6,
  hardLockSeconds: 15 * 60,
};

/** Terminal-wide policy: a little more headroom for a shared device, but still
 *  stops PIN-space enumeration long before it succeeds. */
export const TERMINAL_LOCKOUT_POLICY: LockoutPolicy = {
  softAt: 5,
  cooldownLadderSeconds: [10, 20, 45, 90],
  hardLockAt: 10,
  hardLockSeconds: 15 * 60,
};

export const EMPTY_ATTEMPT_STATE: AttemptState = {
  failedCount: 0,
  lastFailedAt: null,
  lockedUntil: null,
};

export interface AttemptGate {
  blocked: boolean;
  retryAfterSeconds: number;
}

/** Is this identity currently blocked from attempting a PIN? */
export function attemptGate(
  state: AttemptState,
  now: Date,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
): AttemptGate {
  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000),
    };
  }
  if (
    state.failedCount >= policy.softAt &&
    state.lastFailedAt &&
    state.failedCount < policy.hardLockAt
  ) {
    const idx = Math.min(
      state.failedCount - policy.softAt,
      policy.cooldownLadderSeconds.length - 1,
    );
    const cooldown = policy.cooldownLadderSeconds[idx] ?? 0;
    const elapsed = (now.getTime() - state.lastFailedAt.getTime()) / 1000;
    if (elapsed < cooldown) {
      return { blocked: true, retryAfterSeconds: Math.ceil(cooldown - elapsed) };
    }
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

/** Next persisted state after a failed attempt. */
export function registerFailure(
  state: AttemptState,
  now: Date,
  policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY,
): AttemptState {
  const failedCount = state.failedCount + 1;
  const lockedUntil =
    failedCount >= policy.hardLockAt
      ? new Date(now.getTime() + policy.hardLockSeconds * 1000)
      : state.lockedUntil;
  return { failedCount, lastFailedAt: now, lockedUntil };
}

/** Next persisted state after a successful attempt: fully reset. */
export function registerSuccess(): AttemptState {
  return { ...EMPTY_ATTEMPT_STATE };
}

export function isHardLocked(state: AttemptState, now: Date): boolean {
  return !!state.lockedUntil && state.lockedUntil.getTime() > now.getTime();
}
