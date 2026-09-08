import { z } from 'zod';
import { resolveDiscrepancy } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  resolution: z.enum([
    'replacement',
    'credit_note',
    'approved_excess',
    'return_collection',
    'written_off',
  ]),
  creditNoteNumber: z.string().max(60).optional(),
  amountPaise: z.number().int().positive().optional(),
  reason: z.string().max(300).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ discrepancyId: string }> }) {
  try {
    assertSameOrigin(request);
    const { discrepancyId } = await ctx.params;
    const { resolution, ...opts } = schema.parse(await request.json());
    return apiJson(
      await resolveDiscrepancy(
        stockDb(),
        await currentStockActor(),
        discrepancyId,
        resolution,
        opts,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
