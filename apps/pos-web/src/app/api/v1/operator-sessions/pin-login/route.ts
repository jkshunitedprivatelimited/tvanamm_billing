import { NextResponse } from 'next/server';
import { pinLoginCommandSchema } from '@jksh/contracts';
import { pinLogin } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { OPERATOR_COOKIE, operatorCookieOptions } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const cmd = pinLoginCommandSchema.parse(await request.json());
    const { result, operatorToken } = await pinLogin(db(), cmd, requestMeta(request));
    const response = NextResponse.json(result);
    if (operatorToken) {
      response.cookies.set(OPERATOR_COOKIE, operatorToken, operatorCookieOptions);
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
