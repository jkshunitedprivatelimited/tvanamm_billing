import 'server-only';
import { checkOtpVerify, recordOtpVerifyFailure, resetOtpAttempts } from '@jksh/identity';
import { db } from './pool';
import { supabaseServer } from './supabase';
import { msg91WidgetAuthEnabled } from '@/dev-auth-flags';
import { readOtpChallenge } from './otp-challenge';
import { verifyMsg91Otp } from './msg91-otp';
import {
  assertDevAuthSafe,
  devOtpEnabled,
  devOtpMatches,
  syntheticAuthUserId,
} from './dev-session';

export type OtpVerifyOutcome =
  { ok: true; authUserId: string } | { ok: false; retryAfterSeconds?: number };

/**
 * Verify a phone OTP through whichever path is active (dev bypass or Supabase
 * Auth) and apply the shared failure throttle. Returns the auth user id on
 * success — synthetic in dev mode, the real Supabase id otherwise.
 */
export async function verifyPhoneOtp(
  phone: string,
  code: string,
  challengeCookie?: string,
): Promise<OtpVerifyOutcome> {
  const gate = await checkOtpVerify(db(), phone);
  if (!gate.allowed) return { ok: false, retryAfterSeconds: gate.retryAfterSeconds };

  if (devOtpEnabled()) {
    assertDevAuthSafe();
    if (!devOtpMatches(code)) {
      const retry = await recordOtpVerifyFailure(db(), phone);
      return { ok: false, ...(retry ? { retryAfterSeconds: retry } : {}) };
    }
    await resetOtpAttempts(db(), phone);
    return { ok: true, authUserId: syntheticAuthUserId(phone) };
  }

  if (msg91WidgetAuthEnabled()) {
    const requestId = readOtpChallenge(challengeCookie, phone);
    if (!requestId || !(await verifyMsg91Otp(requestId, code, phone))) {
      const retry = await recordOtpVerifyFailure(db(), phone);
      return { ok: false, ...(retry ? { retryAfterSeconds: retry } : {}) };
    }
    await resetOtpAttempts(db(), phone);
    return { ok: true, authUserId: syntheticAuthUserId(phone) };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
  if (error || !data.user) {
    const retry = await recordOtpVerifyFailure(db(), phone);
    return { ok: false, ...(retry ? { retryAfterSeconds: retry } : {}) };
  }
  await resetOtpAttempts(db(), phone);
  return { ok: true, authUserId: data.user.id };
}
