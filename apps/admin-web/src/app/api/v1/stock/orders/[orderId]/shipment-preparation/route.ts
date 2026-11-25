import { z } from 'zod';
import { getShipmentPreparation, saveShipmentPreparation } from '@jksh/stock';
import { assertSameOrigin, apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const orderId = z.uuid().parse((await context.params).orderId);
    const warehouseId = z.uuid().parse(new URL(request.url).searchParams.get('warehouseId'));
    return apiJson(
      await getShipmentPreparation(stockDb(), await currentStockActor(), orderId, warehouseId),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    assertSameOrigin(request);
    const orderId = z.uuid().parse((await context.params).orderId);
    const body = z
      .object({ warehouseId: z.uuid(), expectedRevision: z.number(), details: z.unknown() })
      .strict()
      .parse(await request.json());
    return apiJson(
      await saveShipmentPreparation(
        stockDb(),
        await currentStockActor(),
        orderId,
        body.warehouseId,
        { expectedRevision: body.expectedRevision, details: body.details },
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
