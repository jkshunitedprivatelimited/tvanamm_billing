import 'server-only';
import { verifyMsg91WidgetToken } from './msg91-widget-token';

export class Msg91OtpUnavailable extends Error {
  constructor(readonly reason: 'unavailable' | 'captcha_required' = 'unavailable') {
    super(
      reason === 'captcha_required'
        ? 'SMS login needs a configuration update. Please contact your administrator.'
        : 'The SMS service is temporarily unavailable. Please try again shortly.',
    );
  }
}

async function callProvider(action: 'sendOtp' | 'verifyOtp', body: Record<string, string>) {
  const authKey = process.env.MSG91_AUTHKEY?.trim();
  const widgetId = process.env.MSG91_WIDGET_ID?.trim();
  if (!authKey || !widgetId) throw new Msg91OtpUnavailable();
  try {
    const response = await fetch(`https://api.msg91.com/api/v5/widget/${action}`, {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ widgetId, ...body }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Msg91OtpUnavailable();
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('type' in data) || !('message' in data))
      throw new Msg91OtpUnavailable();
    if (
      data.type === 'error' &&
      typeof data.message === 'string' &&
      /captcha/i.test(data.message)
    ) {
      // Log only an allowlisted reason, never provider bodies or credentials.
      console.error('[MSG91 OTP]', { action, reason: 'captcha_required', status: response.status });
      throw new Msg91OtpUnavailable('captcha_required');
    }
    return { type: data.type, message: data.message, authKey };
  } catch (error) {
    if (error instanceof Msg91OtpUnavailable) throw error;
    throw new Msg91OtpUnavailable();
  }
}

export async function sendMsg91Otp(phone: string): Promise<string> {
  const data = await callProvider('sendOtp', { identifier: phone.replace(/^\+/, '') });
  if (data.type !== 'success' || typeof data.message !== 'string' || !data.message)
    throw new Msg91OtpUnavailable();
  return data.message;
}

export async function verifyMsg91Otp(
  requestId: string,
  code: string,
  phone: string,
): Promise<boolean> {
  const data = await callProvider('verifyOtp', { reqId: requestId, otp: code });
  if (data.type !== 'success' || typeof data.message !== 'string' || !data.message) return false;
  try {
    return await verifyMsg91WidgetToken(data.message, phone, data.authKey);
  } catch {
    throw new Msg91OtpUnavailable();
  }
}
