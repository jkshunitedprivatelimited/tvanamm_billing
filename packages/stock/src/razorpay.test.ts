import { describe, expect, it } from 'vitest';
import { signCheckout, signWebhook, stubRazorpayGateway } from './razorpay';
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
