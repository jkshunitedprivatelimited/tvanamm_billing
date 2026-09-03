import { NextResponse } from 'next/server';
import { storeLogout } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { SESSION_COOKIE, currentSessionId } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const sessionId = await currentSessionId();
    if (sessionId) await storeLogout(db(), sessionId, requestMeta(request));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
