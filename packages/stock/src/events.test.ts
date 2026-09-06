import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, signEventPayload, verifyEventSignature } from './events';
import { StockError } from './errors';

describe('canonicalJson', () => {
  it('is stable regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 1 }),
    );
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('event signing', () => {
  const prev = process.env.STOCK_EVENT_SECRET;
  beforeEach(() => {
    process.env.STOCK_EVENT_SECRET = 'test-secret-please-ignore-0123456789';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.STOCK_EVENT_SECRET;
    else process.env.STOCK_EVENT_SECRET = prev;
  });

  it('round-trips a signature', () => {
    const payload = { billId: 'x', lines: [{ q: 1 }] };
    const sig = signEventPayload(payload);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyEventSignature(payload, sig).verified).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const sig = signEventPayload({ amount: '10.00' });
    expect(() => verifyEventSignature({ amount: '99.00' }, sig)).toThrow(StockError);
  });

  it('rejects a missing signature when a secret is configured', () => {
    expect(() => verifyEventSignature({ a: 1 }, undefined)).toThrow(/signature is required/);
  });

  it('accepts unsigned events (verified:false) with no secret configured', () => {
    delete process.env.STOCK_EVENT_SECRET;
    expect(verifyEventSignature({ a: 1 }, undefined).verified).toBe(false);
  });
});
