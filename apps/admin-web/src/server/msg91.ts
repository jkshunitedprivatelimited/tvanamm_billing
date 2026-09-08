import 'server-only';

/**
 * MSG91 SMS OTP delivery. The app does not generate OTPs — Supabase Auth does,
 * and calls the "Send SMS" hook (see /api/v1/auth/send-sms) with the code to
 * deliver. This module just hands that code to MSG91.
 */

export interface Msg91Config {
  authKey: string;
  templateId: string;
  senderId: string;
  otpVar: string;
}

/** Fully-configured MSG91 settings, or null when SMS delivery is not wired yet
 *  (the app then stays on the dev OTP bypass). */
export function msg91Config(): Msg91Config | null {
  const authKey = process.env.MSG91_AUTHKEY?.trim();
  const templateId = process.env.MSG91_SMS_TEMPLATE_ID?.trim();
  const senderId = process.env.MSG91_SENDER_ID?.trim();
  const otpVarRaw = process.env.MSG91_OTP_VAR?.trim();
  const otpVar = otpVarRaw && otpVarRaw.length > 0 ? otpVarRaw : 'otp';
  if (!authKey || !templateId || !senderId) return null;
  return { authKey, templateId, senderId, otpVar };
}

/** Digits only, no leading +, MSG91 wants country code + number (e.g. 9198…). */
function normalizeMobile(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') ? digits : `91${digits}`;
}

export interface SendOtpResult {
  ok: boolean;
  status: number;
  body: string;
}

export async function sendOtpViaMsg91(
  cfg: Msg91Config,
  phone: string,
  otp: string,
): Promise<SendOtpResult> {
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('template_id', cfg.templateId);
  url.searchParams.set('mobile', normalizeMobile(phone));
  url.searchParams.set('sender', cfg.senderId);
  url.searchParams.set('otp', otp);
  url.searchParams.set('realTimeResponse', '1');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authkey: cfg.authKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    // The OTP value goes in the template variable too, so a Flow-style
    // template that renders ##otp## works without relying on MSG91's own
    // generator.
    body: JSON.stringify({ [cfg.otpVar]: otp }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}
