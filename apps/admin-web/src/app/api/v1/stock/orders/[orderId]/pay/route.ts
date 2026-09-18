import { submitStockOrderForPayment, isStockFeatureEnabled } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    const key = process.env.RAZORPAY_KEY_ID;
    if (!key || !process.env.RAZORPAY_KEY_SECRET || !process.env.RAZORPAY_WEBHOOK_SECRET) {
      return apiJson(
        {
          error: 'payment_unavailable',
          message:
            'Online payment setup is incomplete. Your order is saved; contact central support.',
        },
        { status: 503 },
      );
    }
    if (
      key.startsWith('rzp_live_') &&
      !(await isStockFeatureEnabled(stockDb(), 'stock.razorpay_live'))
    ) {
      return apiJson(
        {
          error: 'payment_unavailable',
          message: 'Live stock payments are not enabled. Your order is saved.',
        },
        { status: 409 },
      );
    }
    return apiJson(await submitStockOrderForPayment(stockDb(), stockActor, orderId));
  } catch (error) {
    return jsonError(error);
  }
}
