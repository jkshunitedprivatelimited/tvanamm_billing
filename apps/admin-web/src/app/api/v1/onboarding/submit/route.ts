import { ownerOutletDetailsSchema } from '@jksh/contracts';
import { submitOutletOnboarding } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, apiJson, jsonError, requestMeta } from '@/server/http';
export async function POST(request: Request) {
  try {
    await submitOutletOnboarding(
      db(),
      await actorOrThrow(),
      ownerOutletDetailsSchema.parse(await request.json()),
      requestMeta(request),
    );
    return apiJson({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
