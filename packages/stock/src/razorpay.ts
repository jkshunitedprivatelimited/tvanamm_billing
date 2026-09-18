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
  keySecret?: string | undefined;
  webhookSecret?: string | undefined;
  /** payment id -> reconciliation state the caller wants fetchPayment to report */
  payments?: Map<string, RazorpayPayment> | undefined;
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

interface RazorpayApiOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}
interface RazorpayApiPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Real Razorpay REST gateway. createOrder / fetchPayment call api.razorpay.com
 * with HTTP Basic auth (key id : key secret); checkout and webhook signatures
 * are verified locally with HMAC-SHA256 exactly as Razorpay documents.
 */
export function httpRazorpayGateway(opts: {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  baseUrl?: string;
}): RazorpayGateway {
  const base = opts.baseUrl ?? 'https://api.razorpay.com/v1';
  const auth = `Basic ${Buffer.from(`${opts.keyId}:${opts.keySecret}`).toString('base64')}`;

  async function call<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: auth, 'content-type': 'application/json' },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Razorpay ${init.method ?? 'GET'} ${path} -> ${String(res.status)}: ${text}`);
    }
    return JSON.parse(text) as T;
  }

  const normStatus = (s: string): RazorpayPayment['status'] =>
    (['created', 'authorized', 'captured', 'failed', 'refunded'] as const).includes(
      s as RazorpayPayment['status'],
    )
      ? (s as RazorpayPayment['status'])
      : 'created';

  return {
    async createOrder({ amountPaise, currency, receipt }) {
      const order = await call<RazorpayApiOrder>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountPaise,
          currency,
          receipt,
          payment_capture: 1,
        }),
      });
      return {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
      };
    },
    verifyCheckoutSignature(orderId, paymentId, signature) {
      return safeEqualHex(signCheckout(orderId, paymentId, opts.keySecret), signature);
    },
    verifyWebhookSignature(rawBody, signature) {
      if (!opts.webhookSecret) return false;
      return safeEqualHex(signWebhook(rawBody, opts.webhookSecret), signature);
    },
    async fetchPayment(paymentId) {
      const p = await call<RazorpayApiPayment>(`/payments/${paymentId}`);
      return {
        id: p.id,
        order_id: p.order_id ?? '',
        amount: p.amount,
        currency: p.currency,
        status: normStatus(p.status),
      };
    },
  };
}

/**
 * Select the gateway from the environment: the real HTTP gateway when a
 * Razorpay key id/secret is configured, otherwise the in-process stub for
 * local dev and tests.
 *
 * The stub signs with a well-known default secret and treats any unknown
 * payment id as instantly captured — fine for tests, but a live production
 * deployment must never silently fall back to it (a caller who read this
 * source could forge a "paid" checkout). So in production, missing real
 * credentials is a hard failure — stock-order prepayment stays unavailable
 * rather than accepting spoofable payments.
 */
export function resolveRazorpayGateway(): RazorpayGateway {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const hasRealCredentials = !!keyId && keyId.startsWith('rzp_') && !!keySecret;

  if (process.env.NODE_ENV === 'production') {
    if (!hasRealCredentials) {
      throw new Error(
        'Razorpay is not configured for production (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing) — refusing to fall back to the test stub.',
      );
    }
    if (!webhookSecret) {
      throw new Error(
        'RAZORPAY_WEBHOOK_SECRET is not configured for production — signed webhooks would be unverifiable.',
      );
    }
  }

  if (hasRealCredentials) {
    return httpRazorpayGateway({ keyId, keySecret, webhookSecret: webhookSecret ?? '' });
  }
  return stubRazorpayGateway({
    keySecret: keySecret ?? 'stub_key_secret',
    webhookSecret: webhookSecret ?? 'stub_webhook_secret',
  });
}
