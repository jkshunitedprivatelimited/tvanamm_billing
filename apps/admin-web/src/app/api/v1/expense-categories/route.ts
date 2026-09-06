import { NextResponse } from 'next/server';
import { createExpenseCategoryCommandSchema } from '@jksh/contracts';
import { createExpenseCategory } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createExpenseCategoryCommandSchema.parse(await request.json());
    return NextResponse.json(await createExpenseCategory(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
