import { NextResponse } from 'next/server';
import { copyOutletItemToMasterCommandSchema } from '@jksh/contracts';
import { copyOutletItemToMaster } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { itemId } = await params;
    const cmd = copyOutletItemToMasterCommandSchema.parse({
      ...(await request.json()),
      outletItemId: itemId,
    });
    return NextResponse.json(await copyOutletItemToMaster(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
