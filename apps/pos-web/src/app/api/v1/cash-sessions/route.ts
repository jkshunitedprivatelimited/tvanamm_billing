import { NextResponse } from 'next/server';
import { openCashSessionCommandSchema } from '@jksh/contracts';
import { openCashSession, getOpenCashSession } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const cmd = openCashSessionCommandSchema.parse(await request.json());
    return NextResponse.json(await openCashSession(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET() {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const session = await getOpenCashSession(db(), actor, actor.outletId);
    return NextResponse.json({ session });
  } catch (error) {
    return jsonError(error);
  }
}
