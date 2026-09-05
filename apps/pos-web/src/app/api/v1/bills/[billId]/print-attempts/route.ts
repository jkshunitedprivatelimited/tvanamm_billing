import { NextResponse } from 'next/server';
import { printAttemptCommandSchema } from '@jksh/contracts';
import { recordPrintAttempt } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { billId } = await params;
    const cmd = printAttemptCommandSchema.parse(await request.json());
    return NextResponse.json(
      await recordPrintAttempt(db(), actor, billId, cmd, requestMeta(request)),
    );
  } catch (error) {
    return jsonError(error);
  }
}
