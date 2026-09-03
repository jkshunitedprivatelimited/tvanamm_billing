import { NextResponse } from 'next/server';
import { requestOtpCommandSchema } from '@jksh/contracts';
import { checkAndRecordOtpSend } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { jsonError } from '@/server/http';

export async function POST(request: Request) {
  try {
    const { phone } = requestOtpCommandSchema.parse(await request.json());
    const gate = await checkAndRecordOtpSend(db(), phone);
    // Same generic response whether or not we actually dispatched.
    if (gate.allowed) {
      const supabase = await supabaseServer();
      await supabase.auth.signInWithOtp({ phone });
    }
    return NextResponse.json({ sent: true, resendAvailableInSeconds: gate.retryAfterSeconds });
  } catch (error) {
    return jsonError(error);
  }
}
