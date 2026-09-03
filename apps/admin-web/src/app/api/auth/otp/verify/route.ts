import { NextResponse } from 'next/server';
import { verifyOtpCommandSchema } from '@jksh/contracts';
import { verifyAdminOtp } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { SESSION_COOKIE, sessionCookieOptions } from '@/server/auth';

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const cmd = verifyOtpCommandSchema.parse(body);
    const meta = requestMeta(request);
    const { result, sessionToken } = await verifyAdminOtp(
      db(),
      { phone: cmd.phone, code: cmd.code, ...(cmd.deviceLabel ? { deviceLabel: cmd.deviceLabel } : {}) },
      meta,
    );
    const response = NextResponse.json(result);
    if (sessionToken) {
      response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions);
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
