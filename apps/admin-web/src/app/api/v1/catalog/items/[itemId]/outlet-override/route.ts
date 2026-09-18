import { NextResponse } from 'next/server';
import { upsertOutletItemOverrideCommandSchema } from '@jksh/contracts';
import { upsertOutletItemOverride } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, assertSameOrigin, jsonError, requestMeta } from '@/server/http';

export async function PUT(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const { itemId } = await params;
    const cmd = upsertOutletItemOverrideCommandSchema.parse({
      ...(await request.json()),
      catalogItemId: itemId,
    });
    return NextResponse.json(
      await upsertOutletItemOverride(db(), actor, cmd, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
