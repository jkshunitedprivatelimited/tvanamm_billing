import { NextResponse } from 'next/server';
import { reviewExpenseCommandSchema } from '@jksh/contracts';
import { reviewExpense } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ expenseId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { expenseId } = await params;
    const cmd = reviewExpenseCommandSchema.parse(await request.json());
    await reviewExpense(db(), actor, expenseId, cmd, requestMeta(request));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
