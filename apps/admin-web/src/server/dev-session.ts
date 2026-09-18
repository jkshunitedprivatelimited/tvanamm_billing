import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';
import { insecureDevAuthEnabled, msg91WidgetAuthEnabled } from '@/dev-auth-flags';

export const DEV_COOKIE = 'jksh_dev';

/**
 * Server-enforced lifetime of the signed admin session (dev bypass and MSG91
 * widget both use it), independent of cookie maxAge. 30 days — sensitive
 * actions still re-prompt OTP via the fresh-auth gate.
 */
export const DEV_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * TEMPORARY admin login bypass: a fixed OTP, no SMS, no Supabase Auth. The gate
 * is `insecureDevAuthEnabled()` — the same predicate the Edge proxy uses.
 * Removed entirely once Supabase Phone Auth + MSG91 is accepted.
 */
export function devOtpEnabled(): boolean {
  return insecureDevAuthEnabled();
}

/** Throw if the insecure bypass is configured in an unsafe place. */
export function assertDevAuthSafe(): void {
  if (!devOtpEnabled()) return;
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('ALLOW_INSECURE_DEV_AUTH must never be set outside development');
  }
  const base = process.env.NEXT_PUBLIC_ADMIN_WEB_URL ?? 'http://localhost:3000';
  let host = '';
  try {
    host = new URL(base).hostname;
  } catch {
    host = '';
  }
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '';
  if (!loopback) {
    throw new Error(
      `Insecure dev auth refused: NEXT_PUBLIC_ADMIN_WEB_URL host "${host}" is not loopback`,
    );
  }
}

export function devOtpMatches(code: string): boolean {
  const expected = Buffer.from(process.env.ADMIN_DEV_OTP ?? '');
  const provided = Buffer.from(code);
  return (
    expected.length > 0 &&
    expected.length === provided.length &&
    timingSafeEqual(provided, expected)
  );
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

// A cookie minted with the fixed development OTP must not survive switching
// to real SMS verification, even when the deployment keeps the same secret.
function sessionPurpose(): string {
  return msg91WidgetAuthEnabled() ? 'msg91' : 'dev';
}

export function signDevSession(accountId: string, phone: string): string {
  const issuedAt = Date.now();
  const body = `${accountId}.${Buffer.from(phone).toString('base64url')}.${String(issuedAt)}`;
  const sig = createHmac('sha256', identityTokenSecret())
    .update(`${sessionPurpose()}:${body}`)
    .digest('base64url');
  return `${body}.${sig}`;
}

/** Verify signature AND server-side expiry from the embedded issuedAt. */
export function readDevSession(value: string | undefined): DevSession | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [accountId, phoneB64, iat, sig] = parts as [string, string, string, string];
  const body = `${accountId}.${phoneB64}.${iat}`;
  const expected = Buffer.from(
    createHmac('sha256', identityTokenSecret())
      .update(`${sessionPurpose()}:${body}`)
      .digest('base64url'),
  );
  const provided = Buffer.from(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  const issuedAt = Number(iat);
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > DEV_SESSION_MAX_AGE_SECONDS * 1000) return null;
  return { accountId, phone: Buffer.from(phoneB64, 'base64url').toString('utf8'), issuedAt };
}

export function devCookieOptions(request: Request): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const proto =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https',
    path: '/',
    maxAge: DEV_SESSION_MAX_AGE_SECONDS,
  };
}
