import { NextResponse } from 'next/server';
import { updateTaxProfileCommandSchema } from '@jksh/contracts';
import { updateTaxProfile } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taxProfileId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { taxProfileId } = await params;
    const cmd = updateTaxProfileCommandSchema.parse(await request.json());
    return NextResponse.json(
      await updateTaxProfile(db(), actor, taxProfileId, cmd, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
