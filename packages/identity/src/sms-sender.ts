/**
 * SMS delivery for Supabase Auth's "Send SMS" hook. Supabase generates and
 * verifies the OTP; this only puts the code into an SMS via MSG91
 * (`docs/plans/billing-data-api-plan.md` §1: MSG91 delivers, Supabase owns the
 * OTP/session lifecycle).
 */
export interface SmsSendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

export interface SmsSender {
  readonly name: string;
  sendOtp(phone: string, code: string): Promise<SmsSendResult>;
}

/** MSG91 numbers are digits only with country code, e.g. 919876543210. */
export function toMsg91Mobile(e164: string): string {
  return e164.replace(/\D/g, '');
}

export interface Msg91Config {
  authKey: string;
  templateId: string;
  senderId?: string;
  otpVarName?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class Msg91SmsSender implements SmsSender {
  readonly name = 'msg91';
  private readonly base: string;
  private readonly timeoutMs: number;
  constructor(private readonly cfg: Msg91Config) {
    this.base = cfg.baseUrl ?? 'https://control.msg91.com/api/v5';
    this.timeoutMs = cfg.timeoutMs ?? 8000;
  }

  async sendOtp(phone: string, code: string): Promise<SmsSendResult> {
    const varName = this.cfg.otpVarName ?? 'otp';
    const body: Record<string, unknown> = {
      template_id: this.cfg.templateId,
      recipients: [{ mobiles: toMsg91Mobile(phone), [varName]: code }],
    };
    if (this.cfg.senderId) body.sender = this.cfg.senderId;

    let res: Response;
    try {
      res = await fetch(`${this.base}/flow/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authkey: this.cfg.authKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // Redacted: never surface the request body / authkey / phone / code.
      const kind = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network';
      return { ok: false, error: kind };
    }

    const json = (await res.json().catch(() => ({}))) as {
      type?: string;
      request_id?: string;
    };
    const ok = res.ok && json.type !== 'error';
    return ok
      ? { ok: true, ...(json.request_id ? { providerRef: json.request_id } : {}) }
      : { ok: false, error: res.ok ? 'provider_error' : `http_${String(res.status)}` };
  }
}

/** No-op sender for local development and CI. Never logs the code or number. */
export class LogSmsSender implements SmsSender {
  readonly name = 'log';
  sendOtp(_phone: string, _code: string): Promise<SmsSendResult> {
    console.info('[sms-sender:log] OTP send requested (no SMS provider configured)');
    return Promise.resolve({ ok: true, providerRef: 'log' });
  }
}

let cached: SmsSender | undefined;

export function getSmsSender(env: Record<string, string | undefined> = process.env): SmsSender {
  if (cached) return cached;
  const authKey = env.MSG91_AUTHKEY;
  const templateId = env.MSG91_SMS_TEMPLATE_ID;
  if (authKey && templateId) {
    cached = new Msg91SmsSender({
      authKey,
      templateId,
      ...(env.MSG91_SENDER_ID ? { senderId: env.MSG91_SENDER_ID } : {}),
      ...(env.MSG91_OTP_VAR ? { otpVarName: env.MSG91_OTP_VAR } : {}),
      ...(env.MSG91_BASE_URL ? { baseUrl: env.MSG91_BASE_URL } : {}),
    });
    return cached;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('MSG91_AUTHKEY / MSG91_SMS_TEMPLATE_ID are required in production');
  }
  cached = new LogSmsSender();
  return cached;
}

export function setSmsSender(sender: SmsSender | undefined): void {
  cached = sender;
}
