import { NextResponse } from 'next/server';
import { pauseOutletItemCommandSchema } from '@jksh/contracts';
import { pauseOutletItem } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { itemId } = await params;
    const cmd = pauseOutletItemCommandSchema.parse({
      ...(await request.json()),
      catalogItemId: itemId,
    });
    await pauseOutletItem(db(), actor, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
