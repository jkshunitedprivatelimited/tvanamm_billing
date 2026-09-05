import { NextResponse } from 'next/server';
import { updateComboCommandSchema } from '@jksh/contracts';
import { updateCombo } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ comboId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { comboId } = await params;
    const cmd = updateComboCommandSchema.parse(await request.json());
    await updateCombo(db(), actor, comboId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
