import { describe, expect, it } from 'vitest';
import { insecureDevAuthEnabled } from './dev-auth-flags';

const ON = {
  NODE_ENV: 'development',
  ALLOW_INSECURE_DEV_AUTH: 'true',
  ADMIN_DEV_OTP: '123456',
};

describe('insecureDevAuthEnabled', () => {
  it('is enabled only when all three signals line up', () => {
    expect(insecureDevAuthEnabled(ON)).toBe(true);
  });

  it('stays off unless NODE_ENV is exactly development', () => {
    expect(insecureDevAuthEnabled({ ...ON, NODE_ENV: 'production' })).toBe(false);
    expect(insecureDevAuthEnabled({ ...ON, NODE_ENV: 'test' })).toBe(false);
    expect(insecureDevAuthEnabled({ ...ON, NODE_ENV: undefined })).toBe(false);
  });

  it('stays off unless the opt-in flag is the literal string "true"', () => {
    expect(insecureDevAuthEnabled({ ...ON, ALLOW_INSECURE_DEV_AUTH: 'false' })).toBe(false);
    expect(insecureDevAuthEnabled({ ...ON, ALLOW_INSECURE_DEV_AUTH: '1' })).toBe(false);
    expect(insecureDevAuthEnabled({ ...ON, ALLOW_INSECURE_DEV_AUTH: 'TRUE' })).toBe(false);
    expect(insecureDevAuthEnabled({ ...ON, ALLOW_INSECURE_DEV_AUTH: undefined })).toBe(false);
  });

  it('stays off unless a non-empty fixed OTP is configured', () => {
    expect(insecureDevAuthEnabled({ ...ON, ADMIN_DEV_OTP: '' })).toBe(false);
    expect(insecureDevAuthEnabled({ ...ON, ADMIN_DEV_OTP: undefined })).toBe(false);
  });

  it('is off for a bare/production-like environment', () => {
    expect(insecureDevAuthEnabled({})).toBe(false);
    expect(insecureDevAuthEnabled({ NODE_ENV: 'production' })).toBe(false);
  });
});
