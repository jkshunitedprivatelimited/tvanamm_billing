import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

function envOrThrow(...keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  throw new Error(`Missing env: one of ${keys.join(', ')}`);
}

/** Supabase client bound to the request cookies. Owns the admin/owner mobile
 *  OTP identity + session (`docs/plans/billing-data-api-plan.md` §1). */
export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(
    envOrThrow('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'),
    envOrThrow('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => {
          try {
            for (const { name, value, options } of list) {
              jar.set({ name, value, ...(options ?? {}) });
            }
          } catch {
            // Called from a Server Component render; middleware refreshes instead.
          }
        },
      },
    },
  );
}

/** Service-role client for the few managed-auth operations (e.g. global sign-out
 *  of a disabled account). Never sent to the browser. */
export function supabaseAdmin() {
  return createClient(
    envOrThrow('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
    envOrThrow('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
