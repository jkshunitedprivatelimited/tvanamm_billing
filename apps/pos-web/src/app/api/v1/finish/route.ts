import { NextResponse } from 'next/server';
import { z } from 'zod';
import { closeCashSessionCommandSchema } from '@jksh/contracts';
import { finishWork, endOperatorSession } from '@jksh/identity';
import { db } from '@/server/pool';
import { currentOperator, operatorToken, OPERATOR_COOKIE } from '@/server/auth';
import { jsonError, requestMeta } from '@/server/http';

const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('finish-work'), expensesReviewed: z.literal(true) }),
  z.object({
    action: z.literal('close-store'),
    expensesReviewed: z.literal(true),
    sessionId: z.string().uuid(),
    cash: closeCashSessionCommandSchema,
  }),
]);
export async function POST(request: Request) {
  try {
    const actor = await currentOperator();
    if (!actor) return NextResponse.json({ message: 'Please sign in again.' }, { status: 401 });
    const parsed = commandSchema.safeParse(await request.json());
    if (!parsed.success)
      return NextResponse.json(
        { message: 'Review your shift expenses before finishing, and check the closing details.' },
        { status: 400 },
      );
    const cmd = parsed.data;
    const meta = requestMeta(request);
    const result = await finishWork(
      db(),
      actor,
      cmd.action === 'close-store' ? { sessionId: cmd.sessionId, command: cmd.cash } : null,
      meta,
    );
    const token = await operatorToken();
    if (token) await endOperatorSession(db(), token, meta);
    const response = NextResponse.json(result);
    response.cookies.set(OPERATOR_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
