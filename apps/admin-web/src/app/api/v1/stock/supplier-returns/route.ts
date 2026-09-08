import { z } from 'zod';
import { initiateSupplierReturn } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  itemId: z.uuid(),
  batchId: z.uuid().nullish(),
  quantityBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
  reason: z.enum(['damaged', 'wrong_item', 'expired', 'rejected', 'quality_failed']),
  purchaseOrderId: z.uuid().nullish(),
  supplierReceiptId: z.uuid().nullish(),
  supplierInvoiceId: z.uuid().nullish(),
  evidenceUrl: z.string().max(500).nullish(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await initiateSupplierReturn(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
