import { NextResponse } from 'next/server';
import { recordAdminLogout } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { getAdminActor } from '@/server/auth';
import { jsonError, requestMeta } from '@/server/http';
import { WS_COOKIE } from '@/server/ws-cookie';

async function logout(request: Request, scope: 'local' | 'global') {
  const { actor } = await getAdminActor();
  const supabase = await supabaseServer();
  await supabase.auth.signOut(scope === 'global' ? { scope: 'global' } : undefined);
  await recordAdminLogout(db(), actor?.accountId ?? null, scope === 'global', requestMeta(request));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(WS_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
}

export async function POST(request: Request) {
  try {
    return await logout(request, 'local');
  } catch (error) {
    return jsonError(error);
  }
}
