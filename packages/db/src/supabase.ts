import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function need(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.length > 0) return value;
  }
  throw new Error(`Missing environment variable: one of ${keys.join(', ')}`);
}

/**
 * Secret-key (service-role) client. Bypasses RLS. **Server-only.** Never import
 * this module from a Client Component or anything bundled for the browser.
 */
export function createServiceRoleClient() {
  return createClient(
    need('SUPABASE_URL'),
    need('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Publishable-key client used only to run Supabase Auth flows
 * (signInWithPassword, MFA challenge) from server code. No session persistence.
 */
export function createAuthClient() {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Publishable-key client for server code acting on behalf of a specific end user
 * by attaching their access token. RLS applies.
 */
export function createUserScopedClient(accessToken: string) {
  return createClient(need('SUPABASE_URL'), need('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export type { SupabaseClient };
