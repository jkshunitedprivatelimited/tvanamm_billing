import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@jksh/config', () => ({ identityTokenSecret: () => 'isolated-test-signing-secret' }));

import { readDevSession, signDevSession } from './dev-session';

afterEach(() => vi.unstubAllEnvs());

describe('local session authentication mode', () => {
  it('rejects development cookies after real MSG91 authentication is enabled', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ALLOW_INSECURE_DEV_AUTH', 'true');
    vi.stubEnv('ADMIN_DEV_OTP', 'test-only');
    vi.stubEnv('MSG91_WIDGET_ID', 'test-widget');
    vi.stubEnv('MSG91_AUTHKEY', 'test-key');
    const devCookie = signDevSession('test-account', '+919999999999');
    expect(readDevSession(devCookie)?.accountId).toBe('test-account');
    vi.stubEnv('ALLOW_INSECURE_DEV_AUTH', 'false');
    expect(readDevSession(devCookie)).toBeNull();
    const smsCookie = signDevSession('test-account', '+919999999999');
    expect(readDevSession(smsCookie)?.accountId).toBe('test-account');
    expect(readDevSession(`${smsCookie}tampered`)).toBeNull();
  });
});
