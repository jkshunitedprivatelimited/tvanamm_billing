import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyMsg91WidgetToken } from './msg91-widget-token';

afterEach(() => vi.unstubAllGlobals());

describe('MSG91 verified identity', () => {
  it('accepts the mobile verified by MSG91 and sends credentials only to its API', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ type: 'success', message: '919999999999' }));
    vi.stubGlobal('fetch', request);
    expect(await verifyMsg91WidgetToken('test-token', '+919999999999', 'test-key')).toBe(true);
    expect(request).toHaveBeenCalledWith(
      'https://api.msg91.com/api/v5/widget/verifyAccessToken',
      expect.objectContaining({
        headers: expect.objectContaining({ authkey: 'test-key' }),
        body: JSON.stringify({ 'access-token': 'test-token' }),
      }),
    );
  });

  it('rejects a valid token for a different phone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ type: 'success', message: '918888888888' })),
    );
    expect(await verifyMsg91WidgetToken('test-token', '+919999999999', 'test-key')).toBe(false);
  });

  it.each([
    { type: 'error', message: '919999999999' },
    { type: 'success', message: 'OTP verified' },
    { type: 'success' },
    null,
  ])('rejects invalid or missing verified identity: %j', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
    expect(await verifyMsg91WidgetToken('test-token', '+919999999999', 'test-key')).toBe(false);
  });

  it('rejects upstream HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    expect(await verifyMsg91WidgetToken('test-token', '+919999999999', 'test-key')).toBe(false);
  });
});
