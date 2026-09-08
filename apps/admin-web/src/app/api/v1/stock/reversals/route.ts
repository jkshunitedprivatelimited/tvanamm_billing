import { z } from 'zod';
import { reverseDocument } from '@jksh/stock';
import { apiJson, assertSameOrigin, jsonError, clean } from '@/server/http';
import { currentStockActor, stockDb } from '@/server/stock';

const schema = z.object({
  sourceDocType: z.string().min(1).max(60),
  sourceDocId: z.uuid(),
  reason: z.string().min(1).max(300),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStockActor();
    const body = schema.parse(await request.json());
    return apiJson(
      await reverseDocument(
        stockDb(),
        actor,
        clean({ organizationId: actor.organizationId, ...body }),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
