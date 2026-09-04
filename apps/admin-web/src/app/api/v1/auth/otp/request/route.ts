import { requestOtpCommandSchema } from '@jksh/contracts';
import { checkAndRecordOtpSend, eligibleForOtp } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { apiJson, jsonError, requestMeta } from '@/server/http';
import { assertDevAuthSafe, devOtpEnabled } from '@/server/dev-session';

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
    return jsonError(error);
  }
}
