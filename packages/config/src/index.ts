import { z } from 'zod';

/** New Supabase keys (sb_publishable_… / sb_secret_…) with legacy fallback. */
function pick(env: Record<string, string | undefined>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Browser-safe configuration. Every value must be reproducible from a
 * `NEXT_PUBLIC_*` variable and must never carry a secret.
 */
const browserEnvironmentSchema = z.object({
  supabaseUrl: z.url(),
  supabasePublishableKey: z.string().min(1),
  adminWebUrl: z.url().default('http://localhost:3000'),
  posWebUrl: z.url().default('http://localhost:3001'),
});

export type BrowserEnvironment = z.infer<typeof browserEnvironmentSchema>;

export function parseBrowserEnvironment(
  env: Record<string, string | undefined>,
): BrowserEnvironment {
  return browserEnvironmentSchema.parse({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: pick(
      env,
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ),
    adminWebUrl: env.NEXT_PUBLIC_ADMIN_WEB_URL,
    posWebUrl: env.NEXT_PUBLIC_POS_WEB_URL,
  });
}

/**
 * Server-only configuration. Loaded exclusively by Next.js server code, Route
 * Handlers, Server Actions, and CLI tooling. Importing this into a Client
 * Component is a build-time mistake we want to keep loud.
 */
const serverEnvironmentSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),

  supabaseUrl: z.url(),
  supabasePublishableKey: z.string().min(1),
  supabaseSecretKey: z.string().min(1),
  supabaseJwksUrl: z.url().optional(),

  /** Session-mode / direct connection for migrations and integration tests. */
  directUrl: z.string().min(1).optional(),
  /** Transaction-mode pooler connection for runtime queries. */
  databaseUrl: z.string().min(1),

  allowedOrigins: z.array(z.string()).min(1),

  identityTokenSecret: z.string().min(32),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(env: Record<string, string | undefined>): ServerEnvironment {
  const rawOrigins = env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:3001';
  return serverEnvironmentSchema.parse({
    nodeEnv: env.NODE_ENV,
    supabaseUrl: env.SUPABASE_URL,
    supabasePublishableKey: pick(env, 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'),
    supabaseSecretKey: pick(env, 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'),
    supabaseJwksUrl: env.SUPABASE_JWKS_URL,
    directUrl: env.DIRECT_URL,
    databaseUrl: env.DATABASE_URL,
    allowedOrigins: rawOrigins
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
    identityTokenSecret: env.IDENTITY_TOKEN_SECRET,
  });
}

let cached: ServerEnvironment | undefined;

/** Parse once, then reuse. Throws on the first invalid boot. */
export function serverEnvironment(): ServerEnvironment {
  cached ??= parseServerEnvironment(process.env);
  return cached;
}

/**
 * The one secret `@jksh/identity` needs (terminal credentials, operator tokens,
 * PIN lookup pepper, invitation tokens) without pulling in the full Supabase
 * environment.
 */
export function identityTokenSecret(env: Record<string, string | undefined> = process.env): string {
  const value = env.IDENTITY_TOKEN_SECRET;
  if (!value || value.length < 32) {
    throw new Error('IDENTITY_TOKEN_SECRET must be set and at least 32 characters');
  }
  return value;
}

/** Connection string for migrations / tests: prefer direct, fall back to runtime. */
export function migrationConnectionString(
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env.DIRECT_URL ?? env.DATABASE_URL;
  if (!value) throw new Error('DIRECT_URL / DATABASE_URL are not set');
  return value;
}
