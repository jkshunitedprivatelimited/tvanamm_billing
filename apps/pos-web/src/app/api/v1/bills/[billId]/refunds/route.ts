import { NextResponse } from 'next/server';
import { createRefundCommandSchema } from '@jksh/contracts';
import { createRefund } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const { billId } = await params;
    const cmd = createRefundCommandSchema.parse({ ...(await request.json()), billId });
    return NextResponse.json(await createRefund(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
