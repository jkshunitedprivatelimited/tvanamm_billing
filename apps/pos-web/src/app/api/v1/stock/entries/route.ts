import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { StockError, recordEmployeeStockEntry } from '@jksh/stock';
import { getOperatorSummary, recordExpense } from '@jksh/identity';
import { currentOperator } from '@/server/auth';
import { db } from '@/server/pool';
import { operatorStockActor, stockDb } from '@/server/stock';
import { jsonError } from '@/server/http';
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json(
        { message: 'Please use this outlet’s billing screen.' },
        { status: 403 },
      );
    const actor = await currentOperator();
    if (!actor?.outletId)
      return NextResponse.json({ message: 'Please sign in again.' }, { status: 401 });
    const outletId = actor.outletId;
    const stockActor = await operatorStockActor(actor);
    const me = await getOperatorSummary(db(), actor);
    const result = await recordEmployeeStockEntry(
      stockDb(),
      stockActor,
      me?.employeeName ?? 'Employee',
      await request.json(),
      (expense) => recordExpense(db(), actor, { ...expense, outletId }),
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        { message: 'Check the quantity, amount and reason.' },
        { status: 400 },
      );
    if (error instanceof StockError)
      return NextResponse.json(
        { message: error.message },
        { status: error.code === 'forbidden' ? 403 : 400 },
      );
    return jsonError(error);
  }
}
