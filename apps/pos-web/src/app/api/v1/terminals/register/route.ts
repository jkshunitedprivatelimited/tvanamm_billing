import { NextResponse } from 'next/server';
import { registerTerminalCommandSchema } from '@jksh/contracts';
import { registerTerminal } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { TERMINAL_COOKIE } from '@/server/auth';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  try {
    const cmd = registerTerminalCommandSchema.parse(await request.json());
    const result = await registerTerminal(db(), cmd, requestMeta(request));
    const response = NextResponse.json(result);
    // Durable server-side copy of the terminal credential so a cleared
    // localStorage (or a fresh browser profile on the same device) does not
    // force the Franchise Owner to re-issue an activation code.
    response.cookies.set(TERMINAL_COOKIE, result.terminalCredential, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: ONE_YEAR,
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
