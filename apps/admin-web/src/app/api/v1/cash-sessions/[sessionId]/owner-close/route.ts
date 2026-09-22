import { ownerCloseRegisterCommandSchema } from '@jksh/contracts';
import { closeOwnerRegister, getOwnerRegisterReview } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, apiJson, assertSameOrigin, jsonError, requestMeta } from '@/server/http';

type Context = { params: Promise<{ sessionId: string }> };
export async function GET(_request: Request, { params }: Context) {
  try {
    const actor = await actorOrThrow();
    return apiJson(await getOwnerRegisterReview(db(), actor, (await params).sessionId));
  } catch (error) {
    return jsonError(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const cmd = ownerCloseRegisterCommandSchema.parse(await request.json());
    return apiJson(
      await closeOwnerRegister(db(), actor, (await params).sessionId, cmd, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
