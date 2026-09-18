import { requestOtpCommandSchema } from '@jksh/contracts';
import { checkAndRecordOtpSend, eligibleForOtp } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { apiJson, jsonError, requestMeta } from '@/server/http';
import { assertDevAuthSafe, devOtpEnabled } from '@/server/dev-session';
import { randomUUID } from 'node:crypto';
import { msg91WidgetAuthEnabled } from '@/dev-auth-flags';
import { Msg91OtpUnavailable, sendMsg91Otp } from '@/server/msg91-otp';
import {
  OTP_CHALLENGE_COOKIE,
  OTP_CHALLENGE_PATH,
  OTP_CHALLENGE_MAX_AGE,
  signOtpChallenge,
} from '@/server/otp-challenge';

export async function POST(request: Request) {
  try {
    const { phone } = requestOtpCommandSchema.parse(await request.json());
    const { correlationId } = requestMeta(request);

    if (devOtpEnabled()) {
      assertDevAuthSafe();
      // The fixed-code path is throttled identically — only the SMS is skipped.
      const devGate = await checkAndRecordOtpSend(db(), phone);
      return apiJson(
        { sent: true, resendAvailableInSeconds: devGate.retryAfterSeconds },
        { correlationId },
      );
    }

    const gate = await checkAndRecordOtpSend(db(), phone);
    if (msg91WidgetAuthEnabled()) {
      if (!gate.allowed)
        return apiJson(
          {
            message: `Please wait ${String(gate.retryAfterSeconds)} seconds before requesting another code.`,
            resendAvailableInSeconds: gate.retryAfterSeconds,
          },
          { status: 429, correlationId },
        );
      const requestId = (await eligibleForOtp(db(), phone))
        ? await sendMsg91Otp(phone)
        : randomUUID();
      const response = apiJson(
        { sent: true, resendAvailableInSeconds: gate.retryAfterSeconds },
        { correlationId },
      );
      response.cookies.set(OTP_CHALLENGE_COOKIE, signOtpChallenge(phone, requestId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: OTP_CHALLENGE_PATH,
        maxAge: OTP_CHALLENGE_MAX_AGE,
      });
      return response;
    }
    // Only dispatch for a number attached to an eligible account; the response
    // shape is identical whether the number is known or not.
    if (gate.allowed && (await eligibleForOtp(db(), phone))) {
      const supabase = await supabaseServer();
      await supabase.auth.signInWithOtp({ phone });
    }
    return apiJson(
      { sent: true, resendAvailableInSeconds: gate.retryAfterSeconds },
      { correlationId },
    );
  } catch (error) {
    if (error instanceof Msg91OtpUnavailable)
      return apiJson({ message: error.message }, { status: 503 });
    return jsonError(error);
  }
}
