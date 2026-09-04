import { NextResponse } from 'next/server';
import { endShift } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request, { params }: { params: Promise<{ shiftId: string }> }) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { shiftId } = await params;
    return NextResponse.json(await endShift(db(), actor, shiftId, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
