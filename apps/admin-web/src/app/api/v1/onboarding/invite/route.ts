import { inviteOutletOwnerSchema } from '@jksh/contracts';
import { inviteOutletOwner } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, apiJson, jsonError, requestMeta } from '@/server/http';
export async function POST(request: Request) {
  try {
    return apiJson(
      await inviteOutletOwner(
        db(),
        await actorOrThrow(),
        inviteOutletOwnerSchema.parse(await request.json()),
        requestMeta(request),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
