import { NextResponse } from 'next/server';
import { recordExpenseCommandSchema } from '@jksh/contracts';
import { recordExpense } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = recordExpenseCommandSchema.parse(await request.json());
    return NextResponse.json(await recordExpense(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
