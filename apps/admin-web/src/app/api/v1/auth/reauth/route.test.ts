import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  request: vi.fn(),
  verify: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'challenge-value' }) }),
}));
vi.mock('@/server/auth', () => ({ getAdminActor: mocks.auth }));
vi.mock('../otp/request/route', () => ({ POST: mocks.request }));
vi.mock('@/server/otp', () => ({ verifyPhoneOtp: mocks.verify }));
vi.mock('@jksh/identity', () => ({ resolveAdminAfterVerify: mocks.resolve }));
vi.mock('@/server/pool', () => ({ db: () => ({}) }));
vi.mock('@/server/http', () => ({
  apiJson: (body: unknown, options?: { status?: number }) => Response.json(body, options),
  jsonError: () => Response.json({ error: 'invalid' }, { status: 400 }),
  requestMeta: () => ({}),
}));
vi.mock('@/server/otp-challenge', () => ({
  OTP_CHALLENGE_COOKIE: 'challenge',
  OTP_CHALLENGE_PATH: '/api/v1',
}));
vi.mock('@/dev-auth-flags', () => ({ localSessionAuthEnabled: () => true }));
vi.mock('@/server/dev-session', () => ({
  DEV_COOKIE: 'session',
  signDevSession: () => 'renewed',
  devCookieOptions: () => ({ path: '/', httpOnly: true }),
}));
vi.mock('@/server/msg91-otp', () => ({ Msg91OtpUnavailable: class extends Error {} }));
import { POST } from './route';
const request = (body: unknown) =>
  new Request('http://localhost/api/v1/auth/reauth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'user', phone: '+919999999999' },
    actor: { accountId: 'account' },
  });
});
it('sends only to the authenticated mobile, using the existing rate-limited request flow', async () => {
  mocks.request.mockResolvedValue(Response.json({ sent: true }));
  expect((await POST(request({ action: 'send' }))).status).toBe(200);
  expect(await (mocks.request.mock.calls[0]![0] as Request).json()).toEqual({
    phone: '+919999999999',
  });
  expect((await POST(request({ action: 'send', phone: '+918888888888' }))).status).toBe(400);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('requires a signed-in account', async () => {
  mocks.auth.mockResolvedValue({ user: null, actor: null });
  expect((await POST(request({ action: 'send' }))).status).toBe(401);
  expect(mocks.request).not.toHaveBeenCalled();
});
it('rejects verification for a different identity without refreshing freshness', async () => {
  mocks.verify.mockResolvedValue({ ok: true, authUserId: 'different-user' });
  expect((await POST(request({ action: 'verify', code: '123456' }))).status).toBe(400);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('renews the same account after OTP verification without changing workspace', async () => {
  mocks.verify.mockResolvedValue({ ok: true, authUserId: 'user' });
  mocks.resolve.mockResolvedValue({
    accountId: 'account',
    result: { outcome: 'select_workspace' },
  });
  const response = await POST(request({ action: 'verify', code: '123456' }));
  expect(await response.json()).toEqual({ verified: true });
  expect(mocks.verify).toHaveBeenCalledWith('+919999999999', '123456', 'challenge-value');
  expect(response.headers.get('set-cookie')).toContain('session=renewed');
  expect(response.headers.get('set-cookie')).not.toContain('workspace');
});
