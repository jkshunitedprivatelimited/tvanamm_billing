import { NextResponse } from 'next/server';
import { closeCashSessionCommandSchema } from '@jksh/contracts';
import { closeCashSession } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { sessionId } = await params;
    const cmd = closeCashSessionCommandSchema.parse(await request.json());
    return NextResponse.json(
      await closeCashSession(db(), actor, sessionId, cmd, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
