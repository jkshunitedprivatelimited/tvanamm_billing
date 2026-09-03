import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';

export const DEV_COOKIE = 'jksh_dev';

export const devCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: false,
  path: '/',
  maxAge: 60 * 60 * 12,
};

/** TEMPORARY admin login: a fixed OTP, no SMS, no Supabase Auth. Non-prod only. */
export function devOtpEnabled(): boolean {
  return !!process.env.ADMIN_DEV_OTP && process.env.NODE_ENV !== 'production';
}

export function devOtpMatches(code: string): boolean {
  const expected = process.env.ADMIN_DEV_OTP ?? '';
  return expected.length > 0 && code === expected;
}

/** Deterministic, phone-derived UUID that stands in for `auth.users.id`. */
export function syntheticAuthUserId(phone: string): string {
  const h = createHash('sha256').update(`jksh-dev-auth:${phone}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface DevSession {
  accountId: string;
  phone: string;
  issuedAt: number;
}

export function signDevSession(accountId: string, phone: string): string {
  const issuedAt = Date.now();
  const body = `${accountId}.${Buffer.from(phone).toString('base64url')}.${String(issuedAt)}`;
  const sig = createHmac('sha256', identityTokenSecret()).update(`dev:${body}`).digest('base64url');
  return `${body}.${sig}`;
}

export function readDevSession(value: string | undefined): DevSession | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [accountId, phoneB64, iat, sig] = parts as [string, string, string, string];
  const body = `${accountId}.${phoneB64}.${iat}`;
  const expected = Buffer.from(
    createHmac('sha256', identityTokenSecret()).update(`dev:${body}`).digest('base64url'),
  );
  const provided = Buffer.from(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return {
    accountId,
    phone: Buffer.from(phoneB64, 'base64url').toString('utf8'),
    issuedAt: Number(iat),
  };
}
