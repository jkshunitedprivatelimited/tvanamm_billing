import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: [
      'tmp/**',
      'output/**',
      '.vercel/**',
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-production/**',
      '**/next-env.d.ts',
      'vitest.workspace.ts',
      '**/vitest.config.ts',
      // Static assets (service worker, etc.) are not linted as source.
      'apps/*/public/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // React app code: keep type-checking, relax rules that fight idiomatic
    // event handlers and fire-and-forget fetches.
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
  {
    // Pages and Route Handlers must go through @jksh/identity functions and the
    // actor-context DB boundary — never a raw pool query
    // (docs/plans/stage-1-audit-remediation.md P1).
    files: ['apps/*/src/app/**/*.{ts,tsx}'],
    ignores: ['apps/*/src/app/**/pool.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='query']",
          message:
            'Do not run raw pool queries from a page or Route Handler. Call a @jksh/identity function that uses withActorContext.',
        },
      ],
    },
  },
  {
    // Tests legitimately use non-null assertions and loose typing on fixtures.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    files: [
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.config.{js,ts,mjs}',
      '**/next.config.{js,mjs,ts}',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: false, project: false },
    },
  },
  {
    // Add the official Next.js rules to each app.
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // App Router only — no `pages/` directory.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
);
