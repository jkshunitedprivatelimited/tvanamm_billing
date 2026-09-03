import { NextResponse } from 'next/server';
import { rejectOperatorSession } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { OPERATOR_COOKIE, operatorToken } from '@/server/auth';

/** Employee tapped "Not me" — revoke the just-created operator session. */
export async function POST(request: Request) {
  try {
    const token = await operatorToken();
    if (token) await rejectOperatorSession(db(), token, requestMeta(request));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(OPERATOR_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
