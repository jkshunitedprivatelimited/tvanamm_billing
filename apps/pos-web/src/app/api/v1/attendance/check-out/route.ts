import { NextResponse } from 'next/server';
import { checkOutCommandSchema } from '@jksh/contracts';
import { checkOut } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const cmd = checkOutCommandSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json(await checkOut(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
