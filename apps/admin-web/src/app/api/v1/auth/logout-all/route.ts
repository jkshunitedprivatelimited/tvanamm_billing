import { NextResponse } from 'next/server';
import { recordAdminLogout } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseServer } from '@/server/supabase';
import { getAdminActor } from '@/server/auth';
import { jsonError, requestMeta } from '@/server/http';
import { WS_COOKIE } from '@/server/ws-cookie';
import { DEV_COOKIE, devOtpEnabled } from '@/server/dev-session';

export async function POST(request: Request) {
  try {
    const { actor } = await getAdminActor();
    if (!devOtpEnabled()) {
      const supabase = await supabaseServer();
      await supabase.auth.signOut({ scope: 'global' });
    }
    await recordAdminLogout(db(), actor?.accountId ?? null, true, requestMeta(request));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(WS_COOKIE, '', { path: '/', maxAge: 0 });
    response.cookies.set(DEV_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
