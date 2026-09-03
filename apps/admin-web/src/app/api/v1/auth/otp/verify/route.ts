import { NextResponse } from 'next/server';
import { verifyOtpCommandSchema } from '@jksh/contracts';
import {
  checkOtpVerify,
  recordOtpVerifyFailure,
  resetOtpAttempts,
  resolveAdminAfterVerify,
} from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { jsonError, requestMeta } from '@/server/http';
import { WS_COOKIE, signWorkspace, wsCookieOptions } from '@/server/ws-cookie';

export async function POST(request: Request) {
  try {
    const cmd = verifyOtpCommandSchema.parse(await request.json());
    const meta = requestMeta(request);

    const gate = await checkOtpVerify(db(), cmd.phone);
    if (!gate.allowed) {
      return NextResponse.json(
        { outcome: 'rejected', retryAfterSeconds: gate.retryAfterSeconds },
        { status: 200 },
      );
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({
      phone: cmd.phone,
      token: cmd.code,
      type: 'sms',
    });
    if (error || !data.user) {
      const retry = await recordOtpVerifyFailure(db(), cmd.phone);
      return NextResponse.json(
        { outcome: 'rejected', ...(retry ? { retryAfterSeconds: retry } : {}) },
        { status: 200 },
      );
    }
    await resetOtpAttempts(db(), cmd.phone);

    const { result } = await resolveAdminAfterVerify(
      db(),
      { authUserId: data.user.id, phone: cmd.phone },
      meta,
    );
    const response = NextResponse.json(result);
    if (result.outcome === 'single_workspace') {
      response.cookies.set(WS_COOKIE, signWorkspace(result.membershipId), wsCookieOptions);
    }
    if (result.outcome === 'rejected') {
      await supabase.auth.signOut();
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
