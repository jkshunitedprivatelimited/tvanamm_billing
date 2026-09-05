import { NextResponse } from 'next/server';
import { reserveReceiptBlockCommandSchema } from '@jksh/contracts';
import { reserveReceiptBlock } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const cmd = reserveReceiptBlockCommandSchema.parse(await request.json());
    return NextResponse.json(await reserveReceiptBlock(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
