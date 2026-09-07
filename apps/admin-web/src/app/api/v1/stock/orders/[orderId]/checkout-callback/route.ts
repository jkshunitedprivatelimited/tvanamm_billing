import { z } from 'zod';
import { confirmCheckoutCallback } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { stockActorFor, stockDb } from '@/server/stock';

const bodySchema = z.object({
  razorpayPaymentId: z.string().min(1).max(120),
  razorpaySignature: z.string().min(1).max(256),
});

export async function POST(request: Request, ctx: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const { orderId } = await ctx.params;
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    const body = bodySchema.parse(await request.json());
    return apiJson(await confirmCheckoutCallback(stockDb(), stockActor, { orderId, ...body }));
  } catch (error) {
    return jsonError(error);
  }
}
