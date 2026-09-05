import { NextResponse } from 'next/server';
import { pauseOutletItemCommandSchema } from '@jksh/contracts';
import { pauseOutletItem } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { itemId } = await params;
    const cmd = pauseOutletItemCommandSchema.parse({
      ...(await request.json()),
      catalogItemId: itemId,
      outletId: actor.outletId,
    });
    await pauseOutletItem(db(), actor, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
