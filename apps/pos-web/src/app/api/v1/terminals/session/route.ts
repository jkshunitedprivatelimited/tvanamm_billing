import { NextResponse } from 'next/server';
import { TERMINAL_COOKIE, registeredTerminalCredential } from '@/server/auth';

/** Lets the login screen recover the terminal credential after a localStorage
 *  wipe, without re-running activation. Returns 404 if the device was never
 *  registered on this origin. */
export async function GET() {
  const credential = await registeredTerminalCredential();
  if (!credential) return NextResponse.json({ error: 'not_registered' }, { status: 404 });
  return NextResponse.json({ credential });
}

/** Forgets this device's terminal registration (used when the stored
 *  credential turns out to point at a terminal that no longer exists). */
export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(TERMINAL_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}
