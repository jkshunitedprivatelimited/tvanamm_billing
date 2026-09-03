import { NextResponse } from 'next/server';
import { requestOtpCommandSchema } from '@jksh/contracts';
import { checkAndRecordOtpSend } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { jsonError } from '@/server/http';
import { devOtpEnabled } from '@/server/dev-session';

export async function POST(request: Request) {
  try {
    const { phone } = requestOtpCommandSchema.parse(await request.json());

    if (devOtpEnabled()) {
      // Fixed dev OTP: nothing to send.
      return NextResponse.json({ sent: true, resendAvailableInSeconds: 0 });
    }

    const gate = await checkAndRecordOtpSend(db(), phone);
    if (gate.allowed) {
      const supabase = await supabaseServer();
      await supabase.auth.signInWithOtp({ phone });
    }
    return NextResponse.json({ sent: true, resendAvailableInSeconds: gate.retryAfterSeconds });
  } catch (error) {
    return jsonError(error);
  }
}
