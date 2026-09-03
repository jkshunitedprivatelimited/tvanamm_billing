import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActorContext } from '@jksh/contracts';
import { loadOperatorContext } from '@jksh/identity';
import { db } from './pool';

export const OPERATOR_COOKIE = 'jksh_op';

export const operatorCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 16,
};

export async function operatorToken(): Promise<string | null> {
  return (await cookies()).get(OPERATOR_COOKIE)?.value ?? null;
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
