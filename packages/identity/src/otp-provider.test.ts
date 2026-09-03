import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FakeOtpProvider,
  Msg91OtpProvider,
  getOtpProvider,
  setOtpProvider,
  toMsg91Mobile,
} from './otp-provider.js';

afterEach(() => {
  setOtpProvider(undefined);
  vi.unstubAllGlobals();
});

describe('toMsg91Mobile', () => {
  it('strips the plus and any spacing', () => {
    expect(toMsg91Mobile('+91 98765 43210')).toBe('919876543210');
  });
});

describe('FakeOtpProvider', () => {
  it('accepts only the fixed code', async () => {
    const p = new FakeOtpProvider('4321');
    expect((await p.send('+919876543210')).ok).toBe(true);
    expect((await p.verify('+919876543210', '4321')).ok).toBe(true);
    expect((await p.verify('+919876543210', '0000')).ok).toBe(false);
  });
});

describe('getOtpProvider', () => {
  it('uses MSG91 when configured', () => {
    const provider = getOtpProvider({
      MSG91_AUTHKEY: 'k',
      MSG91_OTP_TEMPLATE_ID: 't',
      NODE_ENV: 'production',
    });
    expect(provider.name).toBe('msg91');
  });

  it('falls back to the fake provider outside production', () => {
    expect(getOtpProvider({ NODE_ENV: 'development' }).name).toBe('fake');
  });

  it('refuses to fall back in production', () => {
    expect(() => getOtpProvider({ NODE_ENV: 'production' })).toThrow();
  });
});

describe('Msg91OtpProvider', () => {
  it('sends with the authkey header and digits-only mobile', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | undefined;
    const fetchMock: typeof fetch = ((input: unknown, init?: RequestInit) => {
      seenUrl = String(input);
      seenInit = init;
      return Promise.resolve(
        new Response(JSON.stringify({ type: 'success', request_id: 'r1' }), { status: 200 }),
      );
    }) as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);

    const provider = new Msg91OtpProvider({
      authKey: 'auth-key',
      templateId: 'tmpl-1',
      otpLength: 4,
      otpExpiryMinutes: 10,
    });
    const result = await provider.send('+919876543210');
    expect(result).toEqual({ ok: true, providerRef: 'r1' });

    expect(seenUrl).toBe('https://control.msg91.com/api/v5/otp');
    expect(seenInit?.headers).toMatchObject({ authkey: 'auth-key' });
    expect(JSON.parse(String(seenInit?.body))).toMatchObject({
      template_id: 'tmpl-1',
      mobile: '919876543210',
      otp_length: 4,
    });
  });

  it('treats type:error as a failed verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ type: 'error', message: 'OTP not match' }), { status: 200 }),
      ),
    );
    const provider = new Msg91OtpProvider({
      authKey: 'k',
      templateId: 't',
      otpLength: 4,
      otpExpiryMinutes: 10,
    });
    expect(await provider.verify('+919876543210', '9999')).toEqual({
      ok: false,
      error: 'OTP not match',
    });
  });
});
