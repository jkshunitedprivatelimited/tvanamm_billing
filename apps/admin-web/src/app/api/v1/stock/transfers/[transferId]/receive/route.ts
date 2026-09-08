import { z } from 'zod';
import { receiveTransfer } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  receipts: z
    .array(
      z.object({
        lineId: z.uuid(),
        acceptedQtyBase: z.string().regex(/^\d+(\.\d{1,6})?$/),
        damagedQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
        shortageQtyBase: z
          .string()
          .regex(/^\d+(\.\d{1,6})?$/)
          .optional(),
      }),
    )
    .min(1),
});

export async function POST(request: Request, ctx: { params: Promise<{ transferId: string }> }) {
  try {
    assertSameOrigin(request);
    const { transferId } = await ctx.params;
    const { receipts } = schema.parse(await request.json());
    return apiJson(
      await receiveTransfer(stockDb(), await currentStockActor(), transferId, receipts),
    );
  } catch (error) {
    return jsonError(error);
  }
}
