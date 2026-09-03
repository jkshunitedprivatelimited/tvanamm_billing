import { NextResponse } from 'next/server';
import { outletLifecycleCommandSchema } from '@jksh/contracts';
import { outletLifecycle } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const cmd = outletLifecycleCommandSchema.parse(await request.json());
    await outletLifecycle(db(), actor, outletId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
