import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { msg91Config, sendOtpViaMsg91 } from '@/server/msg91';

/**
 * Supabase Auth "Send SMS" hook endpoint. Supabase generates the login OTP and
 * POSTs it here (Standard Webhooks signed) so we can deliver it through MSG91.
 *
 * Configure in the Supabase dashboard → Authentication → Hooks → "Send SMS":
 *   URL:    {NEXT_PUBLIC_ADMIN_WEB_URL}/api/v1/auth/send-sms
 *   Secret: copy into SUPABASE_SEND_SMS_HOOK_SECRET (starts with "v1,whsec_")
 */

interface SendSmsPayload {
  user?: { phone?: string };
  sms?: { otp?: string };
}

/** Standard Webhooks signature check (the scheme Supabase auth hooks use). */
function verify(secret: string, headers: Headers, rawBody: string): boolean {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !timestamp || !sigHeader) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  return sigHeader
    .split(' ')
    .map((p) => p.split(',')[1] ?? '')
    .some((provided) => {
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
}

export async function POST(request: Request) {
  const secret = process.env.SUPABASE_SEND_SMS_HOOK_SECRET?.trim();
  const cfg = msg91Config();
  if (!secret || !cfg) {
    return NextResponse.json({ error: 'SMS delivery is not configured' }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verify(secret, request.headers, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: SendSmsPayload;
  try {
    payload = JSON.parse(rawBody) as SendSmsPayload;
  } catch {
    return NextResponse.json({ error: 'Bad payload' }, { status: 400 });
  }
  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return NextResponse.json({ error: 'Missing phone or otp' }, { status: 400 });
  }

  const result = await sendOtpViaMsg91(cfg, phone, otp);
  if (!result.ok) {
    return NextResponse.json(
      { error: 'MSG91 delivery failed', status: result.status, detail: result.body.slice(0, 500) },
      { status: 502 },
    );
  }
  return NextResponse.json({});
}
