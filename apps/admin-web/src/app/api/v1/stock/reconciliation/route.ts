import { reconcileOutletDay } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';

/** Central-only: follow one outlet's bills for one business date from Billing
 *  through Stock and back, and check the stock ledger against each recipe. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    if (stockActor.role !== 'central_admin')
      return apiJson({ error: 'forbidden', message: 'Central Admin only' }, { status: 403 });
    const body = (await request.json()) as { outletId?: unknown; businessDate?: unknown };
    return apiJson(
      await reconcileOutletDay(db(), stockDb(), {
        organizationId: stockActor.organizationId,
        outletId: body.outletId,
        businessDate: body.businessDate,
      }),
    );
  } catch (error) {
    return jsonError(error);
  }
}
