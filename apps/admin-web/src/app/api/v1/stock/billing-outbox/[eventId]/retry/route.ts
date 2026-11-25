import { z } from 'zod';
import { retryBillingDeadLetter } from '@jksh/stock';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { db } from '@/server/pool';

export async function POST(request: Request, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    if (actor.role !== 'central_admin')
      return apiJson({ error: 'forbidden', message: 'Central Admin only' }, { status: 403 });
    const { eventId } = await ctx.params;
    const requeued = await retryBillingDeadLetter(
      db(),
      z.uuid().parse(eventId),
      actor.scope.organizationId,
    );
    return requeued
      ? apiJson({ requeued: true })
      : apiJson(
          { error: 'not_found', message: 'No failed transfer found in your organization' },
          { status: 404 },
        );
  } catch (error) {
    return jsonError(error);
  }
}
