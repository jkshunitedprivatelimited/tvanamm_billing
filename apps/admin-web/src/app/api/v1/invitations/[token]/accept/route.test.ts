import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), accept: vi.fn(), resolve: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: 'signed-challenge' }) }),
}));
vi.mock('@/server/otp', () => ({ verifyPhoneOtp: mocks.verify }));
vi.mock('@jksh/identity', () => ({
  acceptInvitation: mocks.accept,
  resolveAdminAfterVerify: mocks.resolve,
}));
vi.mock('@/server/pool', () => ({ db: () => ({}) }));
vi.mock('@/server/http', () => ({
  requestMeta: () => ({}),
  jsonError: () => new Response(null, { status: 500 }),
}));
vi.mock('@/dev-auth-flags', () => ({ localSessionAuthEnabled: () => true }));
vi.mock('@/server/dev-session', () => ({
  DEV_COOKIE: 'session',
  devCookieOptions: () => ({ path: '/', httpOnly: true }),
  signDevSession: () => 'signed-session',
}));
vi.mock('@/server/ws-cookie', () => ({
  WS_COOKIE: 'workspace',
  wsCookieOptions: { path: '/' },
  signWorkspace: () => 'signed-workspace',
}));
vi.mock('@/server/otp-challenge', () => ({
  OTP_CHALLENGE_COOKIE: 'challenge',
  OTP_CHALLENGE_PATH: '/api/v1',
}));
vi.mock('@/server/msg91-otp', () => ({ Msg91OtpUnavailable: class extends Error {} }));
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});
function request() {
  return new Request('http://localhost/api/v1/invitations/test-token/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+919999999999', code: '123456' }),
  });
}
it('passes the signed OTP challenge and creates the MSG91 session after acceptance', async () => {
  mocks.verify.mockResolvedValue({ ok: true, authUserId: 'verified-user' });
  mocks.resolve.mockResolvedValue({
    accountId: 'account',
    result: { outcome: 'single_workspace', membershipId: 'membership', redirectTo: '/' },
  });
  const response = await POST(request(), { params: Promise.resolve({ token: 'test-token' }) });
  expect(response.status).toBe(200);
  expect(mocks.verify).toHaveBeenCalledWith('+919999999999', '123456', 'signed-challenge');
  expect(mocks.accept).toHaveBeenCalledWith({}, 'test-token', '+919999999999', {});
  expect(response.cookies.get('session')?.value).toBe('signed-session');
  expect(response.cookies.get('workspace')?.value).toBe('signed-workspace');
  expect(response.cookies.get('challenge')?.maxAge).toBe(0);
});
it('does not consume the invitation when OTP verification fails', async () => {
  mocks.verify.mockResolvedValue({ ok: false });
  const response = await POST(request(), { params: Promise.resolve({ token: 'test-token' }) });
  expect((await response.json()).outcome).toBe('rejected');
  expect(mocks.accept).not.toHaveBeenCalled();
  expect(response.cookies.get('session')).toBeUndefined();
});
