import { z } from 'zod';
import { receiveSupplierShipment } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  purchaseOrderId: z.uuid(),
  warehouseId: z.uuid(),
  receiptNumber: z.string().min(1).max(60),
  idempotencyKey: z.string().min(1).max(120),
  supplierInvoiceNumber: z.string().max(120).nullish(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  landedCosts: z.record(z.string(), z.unknown()).optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.uuid().nullish(),
        itemId: z.uuid(),
        batchCode: z.string().max(80).nullish(),
        manufactureDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        expiryDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullish(),
        acceptedQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
        damagedQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
        rejectedQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
        unitCostPaise: z.number().int().nonnegative(),
        manualEntryReason: z.string().max(200).nullish(),
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
      await receiveSupplierShipment(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
