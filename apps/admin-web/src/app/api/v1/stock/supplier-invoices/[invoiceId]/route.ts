import { getSupplierInvoice } from '@jksh/stock';
import { apiJson, jsonError } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

export async function GET(_request: Request, ctx: { params: Promise<{ invoiceId: string }> }) {
  try {
    const { invoiceId } = await ctx.params;
    return apiJson(await getSupplierInvoice(stockDb(), await currentStockActor(), invoiceId));
  } catch (error) {
    return jsonError(error);
  }
}
