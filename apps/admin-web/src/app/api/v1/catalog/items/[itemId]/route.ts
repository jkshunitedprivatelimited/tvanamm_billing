import { NextResponse } from 'next/server';
import { updateCatalogItemCommandSchema } from '@jksh/contracts';
import { updateCatalogItem } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, assertSameOrigin, jsonError, requestMeta } from '@/server/http';

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await actorOrThrow();
    const { itemId } = await params;
    const cmd = updateCatalogItemCommandSchema.parse(await request.json());
    await updateCatalogItem(db(), actor, itemId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
