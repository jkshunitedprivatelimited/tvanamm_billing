import { NextResponse } from 'next/server';
import { offerLifecycleCommandSchema } from '@jksh/contracts';
import { offerLifecycle } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ offerId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { offerId } = await params;
    const cmd = offerLifecycleCommandSchema.parse(await request.json());
    await offerLifecycle(db(), actor, offerId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
