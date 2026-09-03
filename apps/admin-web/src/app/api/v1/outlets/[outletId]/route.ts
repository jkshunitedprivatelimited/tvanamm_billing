import { NextResponse } from 'next/server';
import { updateOutletConfigCommandSchema } from '@jksh/contracts';
import { updateOutletConfig } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const cmd = updateOutletConfigCommandSchema.parse(await request.json());
    await updateOutletConfig(db(), actor, outletId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
