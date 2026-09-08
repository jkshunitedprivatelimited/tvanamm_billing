import { afterEach, describe, expect, it } from 'vitest';
import {
  signCheckout,
  signWebhook,
  stubRazorpayGateway,
  httpRazorpayGateway,
  resolveRazorpayGateway,
} from './razorpay';
import { computeDeliveryPaise } from './stock-orders';

describe('Razorpay signature verification', () => {
  const gw = stubRazorpayGateway({ keySecret: 'k', webhookSecret: 'w' });

  it('accepts a correctly signed checkout callback', () => {
    const sig = signCheckout('order_1', 'pay_1', 'k');
    expect(gw.verifyCheckoutSignature('order_1', 'pay_1', sig)).toBe(true);
  });

  it('rejects a tampered payment id', () => {
    const sig = signCheckout('order_1', 'pay_1', 'k');
    expect(gw.verifyCheckoutSignature('order_1', 'pay_2', sig)).toBe(false);
  });

  it('rejects a checkout signature made with the wrong secret', () => {
    expect(
      gw.verifyCheckoutSignature('order_1', 'pay_1', signCheckout('order_1', 'pay_1', 'x')),
    ).toBe(false);
  });

  it('verifies a webhook against the raw body', () => {
    const body = '{"event":"payment.captured"}';
    expect(gw.verifyWebhookSignature(body, signWebhook(body, 'w'))).toBe(true);
    expect(gw.verifyWebhookSignature(body + ' ', signWebhook(body, 'w'))).toBe(false);
  });
});

describe('computeDeliveryPaise', () => {
  it('is zero for a free rule and null', () => {
    expect(computeDeliveryPaise(null, 100000)).toBe(0);
    expect(
      computeDeliveryPaise({ kind: 'free', amount_paise: '5000', free_over_paise: null }, 1),
    ).toBe(0);
  });

  it('is the flat amount for a flat rule', () => {
    expect(
      computeDeliveryPaise({ kind: 'flat', amount_paise: '5000', free_over_paise: null }, 10),
    ).toBe(5000);
  });

  it('waives the charge once the threshold is met', () => {
    const rule = {
      kind: 'free_over_threshold' as const,
      amount_paise: '5000',
      free_over_paise: '200000',
    };
    expect(computeDeliveryPaise(rule, 199999)).toBe(5000);
    expect(computeDeliveryPaise(rule, 200000)).toBe(0);
  });
});

describe('httpRazorpayGateway (no network paths)', () => {
  const gw = httpRazorpayGateway({ keyId: 'rzp_test_x', keySecret: 'ks', webhookSecret: 'ws' });

  it('verifies a checkout signature with real HMAC', () => {
    expect(gw.verifyCheckoutSignature('o1', 'p1', signCheckout('o1', 'p1', 'ks'))).toBe(true);
    expect(gw.verifyCheckoutSignature('o1', 'p1', signCheckout('o1', 'p2', 'ks'))).toBe(false);
  });

  it('verifies a webhook against the raw body, and fails closed with no webhook secret', () => {
    const body = '{"event":"payment.captured"}';
    expect(gw.verifyWebhookSignature(body, signWebhook(body, 'ws'))).toBe(true);
    const noSecret = httpRazorpayGateway({
      keyId: 'rzp_test_x',
      keySecret: 'ks',
      webhookSecret: '',
    });
    expect(noSecret.verifyWebhookSignature(body, signWebhook(body, 'ws'))).toBe(false);
  });
});

describe('resolveRazorpayGateway', () => {
  const prevId = process.env.RAZORPAY_KEY_ID;
  const prevSecret = process.env.RAZORPAY_KEY_SECRET;
  afterEach(() => {
    if (prevId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = prevId;
    if (prevSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = prevSecret;
  });

  it('uses the stub with no keys and the HTTP gateway once rzp_ keys are set', () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const stub = resolveRazorpayGateway();
    // stub createOrder never touches the network
    return stub.createOrder({ amountPaise: 100, currency: 'INR', receipt: 'r' }).then((o) => {
      expect(o.id).toMatch(/^order_/);
      process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
      process.env.RAZORPAY_KEY_SECRET = 'sec';
      // Just assert it built without throwing; its createOrder would hit HTTP.
      expect(typeof resolveRazorpayGateway().verifyCheckoutSignature).toBe('function');
    });
  });
});
