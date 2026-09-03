import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { withTransaction } from '@jksh/db';
import type { ActorContext } from '@jksh/contracts';
import { authenticateSessionToken, loadActorContext, IdentityError } from '@jksh/identity';
import { db } from './pool';

export const SESSION_COOKIE = 'jksh_sid';

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 16,
};

export interface StoreSession {
  sessionId: string;
  actor: ActorContext;
}

export async function readStoreSession(): Promise<StoreSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await withTransaction(db(), async (client) => {
      const session = await authenticateSessionToken(client, token);
      const actor = await loadActorContext(client, session.id);
      return { sessionId: session.id, actor };
    });
  } catch (error) {
    if (error instanceof IdentityError) return null;
    throw error;
  }
}

export async function requireStoreSession(): Promise<StoreSession> {
  const state = await readStoreSession();
  if (!state) redirect('/login');
  return state;
}

export async function currentSessionId(): Promise<string | null> {
  return (await readStoreSession())?.sessionId ?? null;
}
