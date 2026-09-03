import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OTP_POLICY,
  EMPTY_OTP_STATE,
  otpSendGate,
  otpVerifyGate,
  registerOtpSend,
  registerOtpVerifyFailure,
  resetOtpState,
} from './otp';

const t0 = new Date('2026-09-03T10:00:00.000Z');

describe('otpSendGate', () => {
  it('allows a first send', () => {
    expect(otpSendGate(EMPTY_OTP_STATE, t0).allowed).toBe(true);
  });

  it('enforces the resend cooldown', () => {
    const sent = registerOtpSend(EMPTY_OTP_STATE, t0);
    const gate = otpSendGate(sent, new Date(t0.getTime() + 5_000));
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBe(DEFAULT_OTP_POLICY.resendCooldownSeconds - 5);
  });

  it('clears the cooldown after it elapses', () => {
    const sent = registerOtpSend(EMPTY_OTP_STATE, t0);
    const later = new Date(t0.getTime() + DEFAULT_OTP_POLICY.resendCooldownSeconds * 1000 + 1);
    expect(otpSendGate(sent, later).allowed).toBe(true);
  });

  it('locks after too many sends in the window', () => {
    let state = EMPTY_OTP_STATE;
    let clock = t0;
    for (let i = 0; i <= DEFAULT_OTP_POLICY.maxSendsPerWindow; i += 1) {
      state = registerOtpSend(state, clock);
      clock = new Date(clock.getTime() + DEFAULT_OTP_POLICY.resendCooldownSeconds * 1000 + 1000);
    }
    const gate = otpSendGate(state, clock);
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('otpVerifyGate', () => {
  it('locks after the configured verify failures', () => {
    let state = EMPTY_OTP_STATE;
    for (let i = 0; i < DEFAULT_OTP_POLICY.maxVerifyFailures; i += 1) {
      state = registerOtpVerifyFailure(state, t0);
    }
    const gate = otpVerifyGate(state, new Date(t0.getTime() + 1000));
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBe(DEFAULT_OTP_POLICY.lockSeconds - 1);
  });

  it('is clear again after the lock window', () => {
    let state = EMPTY_OTP_STATE;
    for (let i = 0; i < DEFAULT_OTP_POLICY.maxVerifyFailures; i += 1) {
      state = registerOtpVerifyFailure(state, t0);
    }
    const after = new Date(t0.getTime() + DEFAULT_OTP_POLICY.lockSeconds * 1000 + 1000);
    expect(otpVerifyGate(state, after).allowed).toBe(true);
  });
});

describe('resetOtpState', () => {
  it('drops all counters', () => {
    const reset = resetOtpState(t0);
    expect(reset.sentCount).toBe(0);
    expect(reset.verifyFailedCount).toBe(0);
    expect(reset.lockedUntil).toBeNull();
  });
});
