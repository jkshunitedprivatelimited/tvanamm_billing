import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { resolveAdminAfterVerify } from '@jksh/identity';
import { getAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { apiJson, jsonError, requestMeta } from '@/server/http';
import { verifyPhoneOtp } from '@/server/otp';
import { OTP_CHALLENGE_COOKIE, OTP_CHALLENGE_PATH } from '@/server/otp-challenge';
import { localSessionAuthEnabled } from '@/dev-auth-flags';
import { DEV_COOKIE, signDevSession, devCookieOptions } from '@/server/dev-session';
import { Msg91OtpUnavailable } from '@/server/msg91-otp';
import { POST as requestOtp } from '../otp/request/route';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send') }).strict(),
  z.object({ action: z.literal('verify'), code: z.string().regex(/^\d{4,8}$/) }).strict(),
]);
export async function POST(request: Request) {
  try {
    const { user, actor } = await getAdminActor();
    if (!user?.phone || !actor?.accountId)
      return apiJson(
        { message: 'Your session has expired. Please sign in again.' },
        { status: 401 },
      );
    const cmd = schema.parse(await request.json());
    // The target phone comes only from the authenticated session, never the caller.
    if (cmd.action === 'send') {
      return await requestOtp(
        new Request(new URL('/api/v1/auth/otp/request', request.url), {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify({ phone: user.phone }),
        }),
      );
    }
    const challenge = (await cookies()).get(OTP_CHALLENGE_COOKIE)?.value;
    const otp = await verifyPhoneOtp(user.phone, cmd.code, challenge);
    if (!otp.ok || otp.authUserId !== user.id)
      return apiJson(
        { message: 'That code was not accepted. Check it or request a new code.' },
        { status: 400 },
      );
    const resolved = await resolveAdminAfterVerify(
      db(),
      { authUserId: user.id, phone: user.phone },
      requestMeta(request),
    );
    if (resolved.result.outcome === 'rejected' || resolved.accountId !== actor.accountId)
      return apiJson(
        { message: 'Could not verify this account. Please sign in again.' },
        { status: 403 },
      );
    const response = NextResponse.json({ verified: true });
    response.cookies.set(OTP_CHALLENGE_COOKIE, '', { path: OTP_CHALLENGE_PATH, maxAge: 0 });
    if (localSessionAuthEnabled())
      response.cookies.set(
        DEV_COOKIE,
        signDevSession(actor.accountId, user.phone),
        devCookieOptions(request),
      );
    // Keep the current workspace selected; this is verification, not an account switch.
    return response;
  } catch (error) {
    if (error instanceof Msg91OtpUnavailable)
      return apiJson({ message: error.message }, { status: 503 });
    return jsonError(error);
  }
}
