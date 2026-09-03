import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'packages',
      include: ['packages/*/src/**/*.{test,spec}.ts'],
      // DB integration tests run over a pooled (often remote) Postgres and do
      // real argon2 hashing, so keep a generous ceiling.
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  },
]);
