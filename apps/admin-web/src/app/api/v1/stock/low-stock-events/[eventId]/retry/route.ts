import { z } from 'zod';
import { retryLowStockEvent } from '@jksh/stock';
import { assertSameOrigin, apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    assertSameOrigin(request);
    const { eventId } = await context.params;
    const id = z
      .string()
      .regex(/^[1-9]\d{0,17}$/)
      .parse(eventId);
    return apiJson(await retryLowStockEvent(stockDb(), await currentStockActor(), id));
  } catch (error) {
    return jsonError(error);
  }
}
