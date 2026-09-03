import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActorContext } from '@jksh/contracts';
import { buildAdminActor, IdentityError } from '@jksh/identity';
import { db } from './pool';
import { supabaseServer } from './supabase';
import { WS_COOKIE, readWorkspace } from './ws-cookie';
import { DEV_COOKIE, devOtpEnabled, readDevSession, syntheticAuthUserId } from './dev-session';

export interface AuthUser {
  id: string;
  phone: string | null;
  /** Seconds since the current Supabase session issued its access token. */
  secondsSinceAuth: number;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  if (devOtpEnabled()) {
    const dev = readDevSession((await cookies()).get(DEV_COOKIE)?.value);
    if (dev) {
      return {
        id: syntheticAuthUserId(dev.phone),
        phone: dev.phone,
        secondsSinceAuth: Math.max(0, Math.floor((Date.now() - dev.issuedAt) / 1000)),
      };
    }
  }

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const issuedAt = session?.expires_at
    ? session.expires_at * 1000 - session.expires_in * 1000
    : Date.now();
  return {
    id: data.user.id,
    phone: data.user.phone ? `+${data.user.phone}` : null,
    secondsSinceAuth: Math.max(0, Math.floor((Date.now() - issuedAt) / 1000)),
  };
}

export async function getAdminActor(): Promise<{
  user: AuthUser | null;
  actor: ActorContext | null;
}> {
  const user = await getAuthUser();
  if (!user) return { user: null, actor: null };
  const membershipId = readWorkspace((await cookies()).get(WS_COOKIE)?.value);
  try {
    const actor = await buildAdminActor(db(), {
      authUserId: user.id,
      membershipId,
      secondsSinceAuth: user.secondsSinceAuth,
    });
    return { user, actor };
  } catch (error) {
    if (error instanceof IdentityError) return { user, actor: null };
    throw error;
  }
}

export async function requireAdminActor(): Promise<ActorContext> {
  const { user, actor } = await getAdminActor();
  if (!user) redirect('/login');
  if (!actor) redirect('/select-workspace');
  return actor;
}
