import { z } from 'zod';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError } from '@/server/http';
import { prepareChefStockDraft } from '@/server/chef-stock-draft';

const schema = z
  .object({ collectionId: z.uuid(), itemId: z.uuid(), revision: z.int().positive() })
  .strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const input = schema.parse(await request.json());
    return apiJson(await prepareChefStockDraft(actor, input));
  } catch (error) {
    return jsonError(error);
  }
}
