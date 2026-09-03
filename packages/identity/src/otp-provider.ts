/**
 * Mobile OTP delivery + verification provider. MSG91 is the confirmed SMS
 * service for TVANAMM. The provider owns code generation, delivery, and
 * verification; `@jksh/identity` owns account resolution, sessions, throttling,
 * and audit.
 */
export interface OtpSendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

export interface OtpVerifyResult {
  ok: boolean;
  error?: string;
}

export interface OtpProvider {
  readonly name: string;
  send(phone: string): Promise<OtpSendResult>;
  verify(phone: string, code: string): Promise<OtpVerifyResult>;
  retry(phone: string): Promise<OtpSendResult>;
}

/** MSG91 numbers are digits only with country code, e.g. 919876543210. */
export function toMsg91Mobile(e164: string): string {
  return e164.replace(/\D/g, '');
}

export interface Msg91Config {
  authKey: string;
  templateId: string;
  otpLength: number;
  otpExpiryMinutes: number;
  senderId?: string;
  baseUrl?: string;
}

export class Msg91OtpProvider implements OtpProvider {
  readonly name = 'msg91';
  private readonly base: string;

  constructor(private readonly cfg: Msg91Config) {
    this.base = cfg.baseUrl ?? 'https://control.msg91.com/api/v5';
  }

  async send(phone: string): Promise<OtpSendResult> {
    const body: Record<string, string | number> = {
      template_id: this.cfg.templateId,
      mobile: toMsg91Mobile(phone),
      otp_length: this.cfg.otpLength,
      otp_expiry: this.cfg.otpExpiryMinutes,
    };
    if (this.cfg.senderId) body.sender = this.cfg.senderId;

    const res = await fetch(`${this.base}/otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.cfg.authKey },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      type?: string;
      request_id?: string;
      message?: string;
    };
    const ok = res.ok && json.type !== 'error';
    return ok
      ? { ok: true, ...(json.request_id ? { providerRef: json.request_id } : {}) }
      : { ok: false, error: json.message ?? `http_${String(res.status)}` };
  }

  async verify(phone: string, code: string): Promise<OtpVerifyResult> {
    const url = new URL(`${this.base}/otp/verify`);
    url.searchParams.set('mobile', toMsg91Mobile(phone));
    url.searchParams.set('otp', code);
    const res = await fetch(url, {
      method: 'GET',
      headers: { authkey: this.cfg.authKey },
    });
    const json = (await res.json().catch(() => ({}))) as {
      type?: string;
      message?: string;
    };
    // MSG91 returns type:"success" and message:"OTP verified success" on success.
    const ok = res.ok && json.type === 'success';
    return ok ? { ok: true } : { ok: false, error: json.message ?? `http_${String(res.status)}` };
  }

  async retry(phone: string): Promise<OtpSendResult> {
    const url = new URL(`${this.base}/otp/retry`);
    url.searchParams.set('mobile', toMsg91Mobile(phone));
    url.searchParams.set('retrytype', 'text');
    const res = await fetch(url, {
      method: 'GET',
      headers: { authkey: this.cfg.authKey },
    });
    const json = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    const ok = res.ok && json.type !== 'error';
    return ok ? { ok: true } : { ok: false, error: json.message ?? `http_${String(res.status)}` };
  }
}

/**
 * Deterministic provider for local development, CI, and tests. Accepts a single
 * fixed code and never sends a real SMS. Never selected when NODE_ENV=production.
 */
export class FakeOtpProvider implements OtpProvider {
  readonly name = 'fake';
  constructor(private readonly fixedCode: string) {}
  send(_phone: string): Promise<OtpSendResult> {
    return Promise.resolve({ ok: true, providerRef: 'fake' });
  }
  verify(_phone: string, code: string): Promise<OtpVerifyResult> {
    return Promise.resolve(
      code === this.fixedCode ? { ok: true } : { ok: false, error: 'invalid_code' },
    );
  }
  retry(_phone: string): Promise<OtpSendResult> {
    return Promise.resolve({ ok: true, providerRef: 'fake' });
  }
}

let cached: OtpProvider | undefined;

/** Resolve the OTP provider from the environment. MSG91 when configured, else
 *  the fake provider outside production. */
export function getOtpProvider(env: Record<string, string | undefined> = process.env): OtpProvider {
  if (cached) return cached;

  const authKey = env.MSG91_AUTHKEY;
  const templateId = env.MSG91_OTP_TEMPLATE_ID;
  if (authKey && templateId) {
    cached = new Msg91OtpProvider({
      authKey,
      templateId,
      otpLength: Number(env.MSG91_OTP_LENGTH ?? '4'),
      otpExpiryMinutes: Number(env.MSG91_OTP_EXPIRY_MINUTES ?? '10'),
      ...(env.MSG91_SENDER_ID ? { senderId: env.MSG91_SENDER_ID } : {}),
      ...(env.MSG91_BASE_URL ? { baseUrl: env.MSG91_BASE_URL } : {}),
    });
    return cached;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('MSG91_AUTHKEY / MSG91_OTP_TEMPLATE_ID are required in production');
  }
  cached = new FakeOtpProvider(env.OTP_FAKE_CODE ?? '1234');
  return cached;
}

/** Test hook. */
export function setOtpProvider(provider: OtpProvider | undefined): void {
  cached = provider;
}
