import { z } from 'zod';
import { createPurchaseOrder, listPurchaseOrders } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(request: Request) {
  try {
    const actor = await currentStockActor();
    const url = new URL(request.url);
    const warehouseId = url.searchParams.get('warehouseId');
    const status = url.searchParams.get('status');
    return apiJson({
      purchaseOrders: await listPurchaseOrders(stockDb(), actor, {
        limit: Number(url.searchParams.get('limit') ?? '50'),
        ...(warehouseId ? { warehouseId } : {}),
        ...(status ? { status } : {}),
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

const schema = z.object({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  poNumber: z.string().min(1).max(60),
  expectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        orderQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
        unitPricePaise: z.number().int().nonnegative(),
        gstRate: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createPurchaseOrder(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
