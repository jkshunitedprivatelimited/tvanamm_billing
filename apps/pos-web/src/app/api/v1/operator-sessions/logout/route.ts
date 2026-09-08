import { NextResponse } from 'next/server';
import { endOperatorSession, endShift, listOpenShifts } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { OPERATOR_COOKIE, currentOperator, operatorToken } from '@/server/auth';

/**
 * "End shift" for a cashier: close their open shift for the day, end the PIN
 * session, and clear the session cookie. The terminal stays registered — the
 * next employee only needs their PIN.
 */
export async function POST(request: Request) {
  try {
    const meta = requestMeta(request);
    const actor = await currentOperator();
    if (actor?.outletId && actor.employeeId) {
      try {
        const mine = (await listOpenShifts(db(), actor, actor.outletId)).find(
          (s) => s.employeeId === actor.employeeId,
        );
        if (mine) await endShift(db(), actor, mine.id, meta);
      } catch {
        // A missing/closed shift must never block sign-out.
      }
    }

    const token = await operatorToken();
    if (token) await endOperatorSession(db(), token, meta);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(OPERATOR_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
