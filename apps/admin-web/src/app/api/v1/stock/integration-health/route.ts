import { getIntegrationHealth } from '@jksh/stock';
import { actorOrThrow, apiJson, jsonError } from '@/server/http';
import { db } from '@/server/pool';
import { stockActorFor, stockDb } from '@/server/stock';

export async function GET() {
  try {
    const actor = await actorOrThrow();
    const stockActor = await stockActorFor(actor);
    if (stockActor.role !== 'central_admin') {
      return apiJson({ error: 'forbidden', message: 'Central Admin only' }, { status: 403 });
    }
    return apiJson(await getIntegrationHealth(db(), stockDb(), stockActor.organizationId));
  } catch (error) {
    return jsonError(error);
  }
}
