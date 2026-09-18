import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { Msg91OtpUnavailable, sendMsg91Otp, verifyMsg91Otp } from './msg91-otp';

beforeEach(() => {
  vi.stubEnv('MSG91_WIDGET_ID', 'test-widget');
  vi.stubEnv('MSG91_AUTHKEY', 'test-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('server-side MSG91 OTP', () => {
  it('sends via the authenticated provider API and returns the challenge id', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ type: 'success', message: 'request-id' }));
    vi.stubGlobal('fetch', request);
    expect(await sendMsg91Otp('+919999999999')).toBe('request-id');
    expect(request).toHaveBeenCalledWith(
      'https://api.msg91.com/api/v5/widget/sendOtp',
      expect.objectContaining({
        headers: expect.objectContaining({ authkey: 'test-key' }),
        body: JSON.stringify({ widgetId: 'test-widget', identifier: '919999999999' }),
      }),
    );
  });
  it('requires both OTP verification and a matching verified mobile', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ type: 'success', message: 'verified-token' }))
      .mockResolvedValueOnce(Response.json({ type: 'success', message: '919999999999' }));
    vi.stubGlobal('fetch', request);
    expect(await verifyMsg91Otp('request-id', '123456', '+919999999999')).toBe(true);
    expect(request).toHaveBeenNthCalledWith(
      1,
      'https://api.msg91.com/api/v5/widget/verifyOtp',
      expect.objectContaining({
        body: JSON.stringify({ widgetId: 'test-widget', reqId: 'request-id', otp: '123456' }),
      }),
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('rejects an OTP verified for a different mobile', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ type: 'success', message: 'verified-token' }))
        .mockResolvedValueOnce(Response.json({ type: 'success', message: '918888888888' })),
    );
    expect(await verifyMsg91Otp('request-id', '123456', '+919999999999')).toBe(false);
  });
  it('rejects an incorrect code without creating a verified token', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ type: 'error', message: 'Invalid OTP' }));
    vi.stubGlobal('fetch', request);
    expect(await verifyMsg91Otp('request-id', 'wrong', '+919999999999')).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([{ type: 'error', message: 'Delivery failed' }, { type: 'success', message: '' }, {}])(
    'does not report success when sending fails: %j',
    async (response) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response)));
      await expect(sendMsg91Otp('+919999999999')).rejects.toBeInstanceOf(Msg91OtpUnavailable);
    },
  );
  it('returns a safe error without leaking the provider request on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private provider details')));
    await expect(sendMsg91Otp('+919999999999')).rejects.toThrow(
      'The SMS service is temporarily unavailable.',
    );
  });
  it('identifies provider CAPTCHA configuration errors instead of suggesting repeated retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ type: 'error', message: 'Invalid Captcha Token.' })),
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(sendMsg91Otp('+919999999999')).rejects.toMatchObject({
        reason: 'captcha_required',
      });
      expect(log).toHaveBeenCalledWith('[MSG91 OTP]', {
        action: 'sendOtp',
        reason: 'captcha_required',
        status: 200,
      });
    } finally {
      log.mockRestore();
    }
  });
});
