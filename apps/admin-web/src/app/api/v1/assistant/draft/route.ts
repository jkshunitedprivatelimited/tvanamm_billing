import { z } from 'zod';
import { actorOrThrow, assertSameOrigin, apiJson, jsonError } from '@/server/http';
import { saveRecipeDraft } from '@/server/recipe-drafts';
import { aiDraftSchema } from '@/server/ai-draft-schema';
const schema = z.object({ id: z.uuid().optional(), draft: aiDraftSchema });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    if (actor.role !== 'central_admin')
      return apiJson({ error: 'Only central admin can save recipe standards.' }, { status: 403 });
    const { id, draft } = schema.parse(await request.json());
    const result = await saveRecipeDraft(actor, draft, id);
    if (!result)
      return apiJson({ error: 'This draft is unavailable or already published.' }, { status: 409 });
    return apiJson(result);
  } catch (error) {
    return jsonError(error);
  }
}
