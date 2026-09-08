import { z } from 'zod';
import { recordSupplierPayment } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  amountPaise: z.number().int().positive(),
  method: z.enum(['bank_transfer', 'upi', 'cheque', 'cash', 'adjustment', 'credit_note']),
  reference: z.string().max(160).nullish(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(request: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  try {
    assertSameOrigin(request);
    const { invoiceId } = await ctx.params;
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await recordSupplierPayment(stockDb(), actor, {
        organizationId: actor.organizationId,
        supplierInvoiceId: invoiceId,
        ...body,
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
