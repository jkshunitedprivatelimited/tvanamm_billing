import { handleRazorpayWebhook } from '@jksh/stock';
import { stockDb } from '@/server/stock';
import { apiJson, jsonError } from '@/server/http';

/**
 * Razorpay webhook endpoint. The signature is verified against the RAW body, so
 * this handler reads text() before parsing. It acknowledges fast; downstream
 * work (marking the order paid) happens inside handleRazorpayWebhook.
 */
export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') ?? '';
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const eventId =
      request.headers.get('x-razorpay-event-id') ??
      (typeof payload.event === 'string'
        ? `${payload.event}:${String(rawBody.length)}`
        : rawBody.slice(0, 64));
    const eventType = typeof payload.event === 'string' ? payload.event : 'unknown';
    const result = await handleRazorpayWebhook(stockDb(), {
      eventId,
      eventType,
      rawBody,
      signature,
      payload,
    });
    return apiJson(result);
  } catch (error) {
    return jsonError(error);
  }
}
