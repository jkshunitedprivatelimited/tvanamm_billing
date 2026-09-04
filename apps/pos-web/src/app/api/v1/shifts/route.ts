import { NextResponse } from 'next/server';
import { startShiftCommandSchema } from '@jksh/contracts';
import { startShift, listOpenShifts } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const cmd = startShiftCommandSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json(await startShift(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET() {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    return NextResponse.json({ shifts: await listOpenShifts(db(), actor, actor.outletId) });
  } catch (error) {
    return jsonError(error);
  }
}
