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
  maxAge: 60 * 60 * 12,
};

export interface SessionState {
  sessionId: string;
  userId: string;
  hasWorkspace: boolean;
  actor: ActorContext | null;
}

/** Resolve the session cookie into a validated state, or null when absent/invalid. */
export async function readSession(): Promise<SessionState | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await withTransaction(db(), async (client) => {
      const session = await authenticateSessionToken(client, token);
      const actor = session.membership_id
        ? await loadActorContext(client, session.id)
        : null;
      return {
        sessionId: session.id,
        userId: session.user_id,
        hasWorkspace: Boolean(session.membership_id),
        actor,
      };
    });
  } catch (error) {
    if (error instanceof IdentityError) return null;
    throw error;
  }
}

/** For pages: bounce to /login when unauthenticated, /select-workspace when unresolved. */
export async function requireActor(): Promise<ActorContext> {
  const state = await readSession();
  if (!state) redirect('/login');
  if (!state.actor) redirect('/select-workspace');
  return state.actor;
}

export async function requireSession(): Promise<SessionState> {
  const state = await readSession();
  if (!state) redirect('/login');
  return state;
}

/** For Route Handlers: throw a typed 401/403 instead of redirecting. */
export async function requireActorRoute(): Promise<ActorContext> {
  const state = await readSession();
  if (!state) throw new IdentityError('unauthenticated', 'Sign in required');
  if (!state.actor) throw new IdentityError('forbidden', 'Select a workspace first');
  return state.actor;
}
