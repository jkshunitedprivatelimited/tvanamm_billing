import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { identityTokenSecret } from '@jksh/config';

export const WS_COOKIE = 'jksh_ws';

export const wsCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 12,
};

/** `<membershipId>.<hmac>` — binds the selected workspace to this deployment. */
export function signWorkspace(membershipId: string): string {
  const sig = createHmac('sha256', identityTokenSecret()).update(membershipId).digest('base64url');
  return `${membershipId}.${sig}`;
}

export function readWorkspace(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const membershipId = value.slice(0, dot);
  const provided = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(
    createHmac('sha256', identityTokenSecret()).update(membershipId).digest('base64url'),
  );
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return membershipId;
}
