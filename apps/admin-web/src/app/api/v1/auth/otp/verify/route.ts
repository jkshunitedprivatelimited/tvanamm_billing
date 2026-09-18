import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyOtpCommandSchema } from '@jksh/contracts';
import { resolveAdminAfterVerify } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { apiJson, jsonError, requestMeta } from '@/server/http';
import { verifyPhoneOtp } from '@/server/otp';
import { WS_COOKIE, signWorkspace, wsCookieOptions } from '@/server/ws-cookie';
import { DEV_COOKIE, devCookieOptions, signDevSession } from '@/server/dev-session';
import { localSessionAuthEnabled } from '@/dev-auth-flags';
import { OTP_CHALLENGE_COOKIE, OTP_CHALLENGE_PATH } from '@/server/otp-challenge';
import { Msg91OtpUnavailable } from '@/server/msg91-otp';

export async function POST(request: Request) {
  try {
    const cmd = verifyOtpCommandSchema.parse(await request.json());
    const meta = requestMeta(request);

    const challenge = (await cookies()).get(OTP_CHALLENGE_COOKIE)?.value;
    const otp = await verifyPhoneOtp(cmd.phone, cmd.code, challenge);
    if (!otp.ok) {
      return NextResponse.json(
        {
          outcome: 'rejected',
          ...(otp.retryAfterSeconds ? { retryAfterSeconds: otp.retryAfterSeconds } : {}),
        },
        { status: 200 },
      );
    }

    const { result, accountId } = await resolveAdminAfterVerify(
      db(),
      { authUserId: otp.authUserId, phone: cmd.phone },
      meta,
    );
    const response = NextResponse.json(result);
    response.cookies.set(OTP_CHALLENGE_COOKIE, '', {
      path: OTP_CHALLENGE_PATH,
      maxAge: 0,
    });
    if (localSessionAuthEnabled() && result.outcome !== 'rejected' && accountId) {
      response.cookies.set(
        DEV_COOKIE,
        signDevSession(accountId, cmd.phone),
        devCookieOptions(request),
      );
    }
    if (result.outcome === 'single_workspace') {
      response.cookies.set(WS_COOKIE, signWorkspace(result.membershipId), wsCookieOptions);
    }
    if (result.outcome === 'rejected' && !localSessionAuthEnabled()) {
      const supabase = await supabaseServer();
      await supabase.auth.signOut();
    }
    return response;
  } catch (error) {
    if (error instanceof Msg91OtpUnavailable)
      return apiJson({ message: error.message }, { status: 503 });
    return jsonError(error);
  }
}
