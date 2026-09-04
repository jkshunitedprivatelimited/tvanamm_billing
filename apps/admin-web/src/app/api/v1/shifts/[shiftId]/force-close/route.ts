import { NextResponse } from 'next/server';
import { forceCloseShiftCommandSchema } from '@jksh/contracts';
import { forceCloseShift } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request, { params }: { params: Promise<{ shiftId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { shiftId } = await params;
    const cmd = forceCloseShiftCommandSchema.parse(await request.json());
    return NextResponse.json(
      await forceCloseShift(db(), actor, shiftId, cmd, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
