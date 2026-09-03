import { NextResponse } from 'next/server';
import { pinLoginCommandSchema } from '@jksh/contracts';
import { pinLogin } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { SESSION_COOKIE, sessionCookieOptions } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const cmd = pinLoginCommandSchema.parse(await request.json());
    const { result, sessionToken } = await pinLogin(db(), cmd, requestMeta(request));
    const response = NextResponse.json(result);
    if (sessionToken) {
      response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions);
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
