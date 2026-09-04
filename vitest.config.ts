import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const DB_TESTS = ['packages/*/src/**/*integration.test.ts'];

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
