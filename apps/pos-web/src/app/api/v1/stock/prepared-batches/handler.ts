import 'server-only';
import { NextResponse } from 'next/server';
import { StockError, type StockActor } from '@jksh/stock';
import { currentOperator } from '@/server/auth';
import { operatorStockActor, stockDb } from '@/server/stock';
import { jsonError } from '@/server/http';
import type { StockPool } from '@jksh/db';

/** Shared POST wrapper for the outlet's prepared-base actions. The outlet is
 *  always the signed-in terminal's, never taken from the request body. */
export async function preparedBatchPost(
  request: Request,
  action: (pool: StockPool, actor: StockActor, body: Record<string, unknown>) => Promise<unknown>,
) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin)
      return NextResponse.json(
        { message: 'Please use this outlet’s billing screen.' },
        { status: 403 },
      );
    const operator = await currentOperator();
    if (!operator?.outletId)
      return NextResponse.json({ message: 'Please sign in again.' }, { status: 401 });
    const actor = await operatorStockActor(operator);
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(
      await action(stockDb(), actor, { ...body, outletId: operator.outletId }),
    );
  } catch (error) {
    if (error instanceof StockError)
      return NextResponse.json(
        { message: error.message },
        {
          status:
            error.code === 'forbidden'
              ? 403
              : error.code === 'not_found'
                ? 404
                : error.code === 'conflict'
                  ? 409
                  : 400,
        },
      );
    return jsonError(error);
  }
}
