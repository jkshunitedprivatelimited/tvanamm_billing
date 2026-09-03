import { NextResponse } from 'next/server';
import { endOperatorSession } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { OPERATOR_COOKIE, operatorToken } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const token = await operatorToken();
    if (token) await endOperatorSession(db(), token, requestMeta(request));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(OPERATOR_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
