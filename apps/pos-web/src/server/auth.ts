import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActorContext } from '@jksh/contracts';
import { loadOperatorContext } from '@jksh/identity';
import { db } from './pool';

export const OPERATOR_COOKIE = 'jksh_op';
/** Durable copy of the terminal credential (see terminals/register). */
export const TERMINAL_COOKIE = 'jksh_terminal';

export const operatorCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 24,
};

export async function operatorToken(): Promise<string | null> {
  return (await cookies()).get(OPERATOR_COOKIE)?.value ?? null;
}

/** The registered terminal's credential from its durable cookie, if any. */
export async function registeredTerminalCredential(): Promise<string | null> {
  return (await cookies()).get(TERMINAL_COOKIE)?.value ?? null;
}

export async function currentOperator(): Promise<ActorContext | null> {
  const token = await operatorToken();
  return token ? loadOperatorContext(db(), token) : null;
}

export async function requireOperator(): Promise<ActorContext> {
  const actor = await currentOperator();
  if (!actor) redirect('/login');
  return actor;
}
