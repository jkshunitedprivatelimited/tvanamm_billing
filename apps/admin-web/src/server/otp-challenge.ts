import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';

export const OTP_CHALLENGE_COOKIE = 'jksh_otp_verification';
export const OTP_CHALLENGE_PATH = '/api/v1';
export const OTP_CHALLENGE_MAX_AGE = 10 * 60;

function signature(payload: string): string {
  return createHmac('sha256', identityTokenSecret())
    .update(`otp-challenge:${payload}`)
    .digest('base64url');
}

export function signOtpChallenge(phone: string, requestId: string): string {
  const payload = Buffer.from(JSON.stringify({ phone, requestId, issuedAt: Date.now() })).toString(
    'base64url',
  );
  return `${payload}.${signature(payload)}`;
}

export function readOtpChallenge(value: string | undefined, phone: string): string | null {
  if (!value) return null;
  const [payload, sig, extra] = value.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const actual = Buffer.from(sig);
  const expected = Buffer.from(signature(payload));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      !data ||
      typeof data !== 'object' ||
      !('phone' in data) ||
      !('requestId' in data) ||
      !('issuedAt' in data)
    )
      return null;
    if (
      data.phone !== phone ||
      typeof data.requestId !== 'string' ||
      !data.requestId ||
      typeof data.issuedAt !== 'number'
    )
      return null;
    const age = Date.now() - data.issuedAt;
    return age >= 0 && age < OTP_CHALLENGE_MAX_AGE * 1000 ? data.requestId : null;
  } catch {
    return null;
  }
}
