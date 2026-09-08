import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ActorContext } from '@jksh/contracts';
import { buildAdminActor, IdentityError } from '@jksh/identity';
import { db } from './pool';
import { supabaseServer } from './supabase';
import { WS_COOKIE, readWorkspace } from './ws-cookie';
import { DEV_COOKIE, readDevSession, syntheticAuthUserId } from './dev-session';
import { localSessionAuthEnabled } from '@/dev-auth-flags';

export interface AuthUser {
  id: string;
  phone: string | null;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  if (localSessionAuthEnabled()) {
    const local = readDevSession((await cookies()).get(DEV_COOKIE)?.value);
    if (local) return { id: syntheticAuthUserId(local.phone), phone: local.phone };
  }

  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, phone: data.user.phone ? `+${data.user.phone}` : null };
}

export async function getAdminActor(): Promise<{
  user: AuthUser | null;
  actor: ActorContext | null;
}> {
  const user = await getAuthUser();
  if (!user) return { user: null, actor: null };
  const membershipId = readWorkspace((await cookies()).get(WS_COOKIE)?.value);
  try {
    // Fresh-auth age comes from the persisted last_otp_at, not the token.
    const actor = await buildAdminActor(db(), { authUserId: user.id, membershipId });
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
