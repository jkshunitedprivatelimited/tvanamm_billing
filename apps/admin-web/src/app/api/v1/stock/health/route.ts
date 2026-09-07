import { isStockFeatureEnabled } from '@jksh/stock';
import { stockDb } from '@/server/stock';
import { apiJson, jsonError } from '@/server/http';

export async function GET() {
  try {
    // isStockFeatureEnabled opens a withStockActorContext transaction, so a
    // successful call also proves the Stock database is reachable.
    const enabled = await isStockFeatureEnabled(stockDb(), 'stock.enabled');
    return apiJson({ ok: true, stockEnabled: enabled });
  } catch (error) {
    return jsonError(error);
  }
}
