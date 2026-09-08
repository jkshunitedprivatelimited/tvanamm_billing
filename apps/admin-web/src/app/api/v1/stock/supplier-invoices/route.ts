import { z } from 'zod';
import { createSupplierInvoice } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  supplierId: z.uuid(),
  supplierReceiptId: z.uuid().nullish(),
  invoiceNumber: z.string().min(1).max(120),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  amountPaise: z.number().int().nonnegative(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await createSupplierInvoice(stockDb(), actor, {
        organizationId: actor.organizationId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
