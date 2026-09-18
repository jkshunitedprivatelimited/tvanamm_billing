import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@jksh/config', () => ({ identityTokenSecret: () => 'isolated-challenge-test-secret' }));
import { OTP_CHALLENGE_MAX_AGE, readOtpChallenge, signOtpChallenge } from './otp-challenge';

afterEach(() => vi.useRealTimers());

describe('OTP challenge cookie', () => {
  it('binds the provider request to the requested phone and rejects tampering', () => {
    const cookie = signOtpChallenge('+919999999999', 'provider-request');
    expect(readOtpChallenge(cookie, '+919999999999')).toBe('provider-request');
    expect(readOtpChallenge(cookie, '+918888888888')).toBeNull();
    expect(readOtpChallenge(`${cookie}tampered`, '+919999999999')).toBeNull();
    expect(readOtpChallenge(`${cookie}.extra`, '+919999999999')).toBeNull();
    expect(readOtpChallenge(undefined, '+919999999999')).toBeNull();
  });
  it('rejects expired and future-dated challenges', () => {
    vi.useFakeTimers();
    const now = Date.now();
    const cookie = signOtpChallenge('+919999999999', 'provider-request');
    vi.setSystemTime(now + OTP_CHALLENGE_MAX_AGE * 1000);
    expect(readOtpChallenge(cookie, '+919999999999')).toBeNull();
    vi.setSystemTime(now - 1);
    expect(readOtpChallenge(cookie, '+919999999999')).toBeNull();
  });
});
