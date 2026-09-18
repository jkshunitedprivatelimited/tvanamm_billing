import { z } from 'zod';
import { approveOutletOnboarding } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, apiJson, jsonError, requestMeta } from '@/server/http';
export async function POST(request: Request) {
  try {
    const cmd = z
      .object({ franchiseId: z.uuid(), transportChargePaise: z.int().min(0).max(100_000_00) })
      .parse(await request.json());
    return apiJson(
      await approveOutletOnboarding(
        db(),
        await actorOrThrow(),
        cmd.franchiseId,
        cmd.transportChargePaise,
        requestMeta(request),
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}
