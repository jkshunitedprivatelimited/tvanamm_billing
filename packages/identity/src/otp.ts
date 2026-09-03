/**
 * Mobile OTP send/verify throttling. Pure functions over the persisted
 * `identity.otp_attempts` row. Compensating control for the MVP's single factor
 * (`advanced-login.md` "Confirmed Mobile Identity Rules").
 */

export interface OtpAttemptState {
  sentCount: number;
  lastSentAt: Date | null;
  verifyFailedCount: number;
  lastFailedAt: Date | null;
  lockedUntil: Date | null;
  windowStartedAt: Date;
}

export interface OtpPolicy {
  /** Minimum seconds between OTP sends to one number. */
  resendCooldownSeconds: number;
  /** Max sends within the rolling window before a lock. */
  maxSendsPerWindow: number;
  /** Rolling window length in seconds for send counting. */
  sendWindowSeconds: number;
  /** Verify failures before a lock. */
  maxVerifyFailures: number;
  /** Lock duration in seconds after too many sends or failures. */
  lockSeconds: number;
}

export const DEFAULT_OTP_POLICY: OtpPolicy = {
  resendCooldownSeconds: 30,
  maxSendsPerWindow: 5,
  sendWindowSeconds: 60 * 60,
  maxVerifyFailures: 5,
  lockSeconds: 15 * 60,
};

export const EMPTY_OTP_STATE: OtpAttemptState = {
  sentCount: 0,
  lastSentAt: null,
  verifyFailedCount: 0,
  lastFailedAt: null,
  lockedUntil: null,
  windowStartedAt: new Date(0),
};

function secondsUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / 1000));
}

export interface OtpGate {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** May we send an OTP to this number right now? */
export function otpSendGate(
  state: OtpAttemptState,
  now: Date,
  policy: OtpPolicy = DEFAULT_OTP_POLICY,
): OtpGate {
  if (state.lockedUntil && state.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: secondsUntil(state.lockedUntil, now) };
  }
  if (state.lastSentAt) {
    const nextAllowed = new Date(
      state.lastSentAt.getTime() + policy.resendCooldownSeconds * 1000,
    );
    if (nextAllowed > now) {
      return { allowed: false, retryAfterSeconds: secondsUntil(nextAllowed, now) };
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** New state after an OTP is sent. Applies the rolling window and lock. */
export function registerOtpSend(
  state: OtpAttemptState,
  now: Date,
  policy: OtpPolicy = DEFAULT_OTP_POLICY,
): OtpAttemptState {
  const windowExpired =
    now.getTime() - state.windowStartedAt.getTime() > policy.sendWindowSeconds * 1000;
  const windowStartedAt = windowExpired ? now : state.windowStartedAt;
  const sentCount = (windowExpired ? 0 : state.sentCount) + 1;
  const lockedUntil =
    sentCount > policy.maxSendsPerWindow
      ? new Date(now.getTime() + policy.lockSeconds * 1000)
      : state.lockedUntil;
  return {
    ...state,
    sentCount,
    lastSentAt: now,
    windowStartedAt,
    lockedUntil,
  };
}

export function otpVerifyGate(state: OtpAttemptState, now: Date): OtpGate {
  if (state.lockedUntil && state.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: secondsUntil(state.lockedUntil, now) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function registerOtpVerifyFailure(
  state: OtpAttemptState,
  now: Date,
  policy: OtpPolicy = DEFAULT_OTP_POLICY,
): OtpAttemptState {
  const verifyFailedCount = state.verifyFailedCount + 1;
  const lockedUntil =
    verifyFailedCount >= policy.maxVerifyFailures
      ? new Date(now.getTime() + policy.lockSeconds * 1000)
      : state.lockedUntil;
  return { ...state, verifyFailedCount, lastFailedAt: now, lockedUntil };
}

export function resetOtpState(now: Date): OtpAttemptState {
  return { ...EMPTY_OTP_STATE, windowStartedAt: now };
}
