import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const DB_TESTS = ['packages/*/src/**/*integration.test.ts'];

/**
 * Integration tests seed and (best-effort) tear down real rows. When they run
 * against a *local* Postgres, redirect them to a dedicated `<db>_test` database
 * so a partial cleanup never leaves fixture data in the database the dev
 * servers read. A remote/pooled URL (CI, Supabase) is left untouched.
 */
function isolateLocalDb(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(raw)) {
    // Shared app databases must never receive integration-test fixtures.
    if (process.env.ALLOW_REMOTE_INTEGRATION_TESTS !== 'true') {
      throw new Error(
        `${name} points to a remote database. Use an isolated local test database, or explicitly set ALLOW_REMOTE_INTEGRATION_TESTS=true for a dedicated remote test project.`,
      );
    }
    return raw;
  }
  if (/\/[a-z0-9_]+_test(\?|$)/i.test(raw)) return raw;
  return raw.replace(/\/([a-z0-9_]+)(\?|$)/i, '/$1_test$2');
}

const dbEnv: Record<string, string> = {};
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'STOCK_DATABASE_URL', 'STOCK_DIRECT_URL']) {
  const v = isolateLocalDb(key);
  if (v) dbEnv[key] = v;
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/src/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', ...DB_TESTS],
        },
      },
      {
        test: {
          name: 'integration',
          include: DB_TESTS,
          exclude: ['**/node_modules/**'],
          env: dbEnv,
          // These share one Postgres and touch overlapping reference data, so
          // run them one file at a time. They also do real argon2 hashing over a
          // (often remote) pooled connection.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: {
          alias: {
            '@/': `${fileURLToPath(new URL('./apps/admin-web/src/', import.meta.url))}`,
          },
        },
        test: {
          name: 'admin-web',
          include: ['apps/admin-web/src/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**'],
          environment: 'node',
        },
      },
    ],
  },
});
