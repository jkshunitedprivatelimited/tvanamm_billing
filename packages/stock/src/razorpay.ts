import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay is used only for Franchise Owner prepayment of JKSH stock orders,
 * never for Store POS customer UPI
 * (`docs/architecture/franchise-owner-stock-portal.md` "Razorpay Boundary").
 * All order creation, signature verification, and reconciliation happen
 * server-side; a browser callback is only a provisional signal.
 */
export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
}

export interface RazorpayGateway {
  createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
  }): Promise<RazorpayOrder>;
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, 'hex');
    bufB = Buffer.from(b, 'hex');
  } catch {
    return false;
  }
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** `razorpay_signature` for a Checkout callback: HMAC(order_id + "|" + payment_id). */
export function signCheckout(orderId: string, paymentId: string, keySecret: string): string {
  return hmacHex(keySecret, `${orderId}|${paymentId}`);
}

/** Webhook signature: HMAC of the raw request body with the webhook secret. */
export function signWebhook(rawBody: string, webhookSecret: string): string {
  return hmacHex(webhookSecret, rawBody);
}

export interface StubOptions {
  keySecret?: string;
  webhookSecret?: string;
  /** payment id -> reconciliation state the caller wants fetchPayment to report */
  payments?: Map<string, RazorpayPayment>;
}

/**
 * In-process gateway for local dev and tests. Signature checks use real HMAC so
 * an invalid signature is genuinely rejected; fetchPayment reads a caller-seeded
 * map so a test can model captured / failed / pending outcomes.
 */
export function stubRazorpayGateway(opts: StubOptions = {}): RazorpayGateway {
  const keySecret = opts.keySecret ?? 'stub_key_secret';
  const webhookSecret = opts.webhookSecret ?? 'stub_webhook_secret';
  const payments = opts.payments ?? new Map<string, RazorpayPayment>();

  return {
    createOrder({ amountPaise, currency }) {
      return Promise.resolve({
        id: `order_${randomUUID().replace(/-/g, '')}`,
        amount: amountPaise,
        currency,
        status: 'created',
      });
    },
    verifyCheckoutSignature(orderId, paymentId, signature) {
      return safeEqualHex(signCheckout(orderId, paymentId, keySecret), signature);
    },
    verifyWebhookSignature(rawBody, signature) {
      return safeEqualHex(signWebhook(rawBody, webhookSecret), signature);
    },
    fetchPayment(paymentId) {
      const known = payments.get(paymentId);
      if (known) return Promise.resolve(known);
      return Promise.resolve({
        id: paymentId,
        order_id: '',
        amount: 0,
        currency: 'INR',
        status: 'captured',
      });
    },
  };
}

/**
 * Select the gateway from the environment. With no Razorpay keys configured this
 * is the stub (dev). A real HTTP implementation is wired in S7 hardening; until
 * then a configured key still uses the stub's local signing so flows are
 * testable end to end.
 */
export function resolveRazorpayGateway(): RazorpayGateway {
  return stubRazorpayGateway({
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? 'stub_key_secret',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? 'stub_webhook_secret',
  });
}
