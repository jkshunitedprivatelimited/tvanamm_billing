import { NextResponse } from 'next/server';
import { recordExpenseCommandSchema } from '@jksh/contracts';
import { recordExpense } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { currentOperator } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor?.outletId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    const parsed = recordExpenseCommandSchema.safeParse({
      ...(await request.json()),
      outletId: actor.outletId,
    });
    if (!parsed.success)
      return NextResponse.json(
        { message: 'Enter a valid amount, category and reason for this expense.' },
        { status: 400 },
      );
    return NextResponse.json(await recordExpense(db(), actor, parsed.data, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
