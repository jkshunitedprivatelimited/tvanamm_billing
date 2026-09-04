# Stage 1 Audit Remediation — Status

Tracks `docs/plans/stage-1-audit-remediation.md` against the implementation.
Legend: **done** (implemented + tested), **deferred** (needs JKSH approval to
skip for Stage 1, with rationale).

## P0 — Credential Incident — OWNER: JKSH account holder

Not actionable from the codebase and must not be handled in chat.

- [ ] Reset the dev project database password; update `DATABASE_URL` / `DIRECT_URL`
      in local + deployment secret stores; restart pooled services; confirm the
      old password fails.
- [ ] Issue a new `sb_secret_…` key; update `SUPABASE_SECRET_KEY`; verify account
      disable / global sign-out; delete the leaked key.

The repo is clean of real Supabase secret values. `.env` is gitignored and no
secret key reaches a browser bundle (server-only imports). A literal search for
`sb_secret` is expected to find documentation, `.env.example`, config code, and
the fake CI value `sb_secret_ci`; review matches for an actual secret value
rather than expecting zero textual matches.

## Independent re-verification — resolved 2026-09-04

The 2026-09-03 independent review confirmed formatting, lint, typecheck, and
both production builds, but found the gaps below. All are now fixed and
re-tested (see the Verification block at the end).

- [x] **P0/P1 — Make the production CSP compatible with Next.js.** Both proxies
      (`apps/admin-web/src/proxy.ts`, `apps/pos-web/src/proxy.ts`) now mint a
      per-request base64 nonce, set it on the request `Content-Security-Policy`
      header (so Next threads it into every `<script>` it emits) and on the
      response header as `script-src 'self' 'nonce-…' 'strict-dynamic'` in
      production (`'unsafe-inline'`/`'unsafe-eval'` only in dev). Both root
      layouts set `export const dynamic = 'force-dynamic'` because Next only
      injects the nonce on a dynamic render — a prerendered page would ship
      scripts the CSP then blocks. Static CSP removed from both
      `next.config.mjs` `headers()`. Verified with a headless-Chromium
      production smoke test on Admin `/login` + `/` and POS `/login` +
      `/register`: pages hydrate, client `fetch` to `/api/v1/auth/otp/request`
      returns 200, and the browser reports **zero CSP violations** and zero page
      errors. Header nonce == HTML nonce confirmed within a single request.
- [x] **P1 — Fix the already-locked employee PIN path.** `store-auth.pinLogin`
      now routes a locked employee, an inactive employee, and a wrong PIN all
      through the shared `fail()` helper: it increments the terminal-wide
      counter, calls `verifyDummyPin` for timing, emits the safe
      `pin.login_failed` / `pin.locked` audit (no PIN), and returns the one
      generic `invalid` response. Only the terminal-level hard lock still
      discloses `locked`. Regression test: `integration.test` "a disabled
      employee PIN login returns the generic invalid reason and counts on the
      terminal" asserts `reason === 'invalid'` and `failed_count` +1.
- [x] **P1 — Complete database-enforced tenant integrity.** Migration
      `0012_tenant_integrity.sql` adds composite unique keys
      `franchises (id, brand_id)` and `outlets (id, franchise_id)` plus
      MATCH-SIMPLE composite foreign keys: `outlets (franchise_id, brand_id)` →
      franchises; `store_employees` / `terminals` /
      `terminal_activation_codes (outlet_id, franchise_id)` → outlets;
      `memberships (franchise_id, brand_id)` → franchises. The
      franchise-owner membership insert now carries `brand_id`
      (`invitations.ts`, `seed.ts`, `integration.test` `seedAccount`) so the FK
      is enforced rather than skipped on a NULL. Test: `integration.test` "DB
      constraints reject cross-brand / cross-franchise tenant rows (migration
      0012)" directly attempts each invalid insert and asserts the named
      constraint fires. Applied to the dev Supabase project (`db:status` → 12
      applied; a pre-flight mismatch scan returned 0 rows).
- [x] **P1 — Use one dev-auth feature gate everywhere.**
      `apps/admin-web/src/dev-auth-flags.ts` `insecureDevAuthEnabled(env?)` is
      the single predicate (development + `ALLOW_INSECURE_DEV_AUTH === 'true'` +
      non-empty `ADMIN_DEV_OTP`); `dev-session.ts` `devOtpEnabled()` and both
      the admin proxy's Supabase-refresh skip and the OTP routes delegate to
      it. `dev-auth-flags.test.ts` covers every flag combination, including that
      the predicate is false (so Supabase session refresh resumes) whenever any
      one signal is missing or `NODE_ENV` is not exactly `development`. A new
      `admin-web` vitest project runs it.
- [x] **P2 — Throttle the temporary OTP request path consistently.** The dev
      branch of `POST /api/v1/auth/otp/request` now calls
      `checkAndRecordOtpSend` before returning and echoes
      `resendAvailableInSeconds`; only the SMS dispatch is skipped. Response
      shape is unchanged.
- [x] **Verification — rerun external checks.** All 12 database-backed
      integration tests run with no skips against both a local Postgres 16
      cluster and the dev Supabase project (0001–0012). `npm audit --omit=dev
      --audit-level=high` with registry access → **0 vulnerabilities**.
- [ ] **Billing V1 — implementation has not landed.** The present codebase has
      identity, outlet/terminal foundations, contracts, and the build plan, but
      no menu/catalog persistence, cart/checkout, sale/payment persistence,
      receipt allocation/printing, shift/cash management, full/partial refunds,
      offline sync, retention/export, or billing reports. Implement and verify
      `docs/plans/billing-v1-build-plan.md`; the POS placeholder must be replaced
      only after the end-to-end billing acceptance tests pass.

Required re-verification after these changes — all run 2026-09-04:

1. `npm run format:check`, `npm run lint`, `npm run typecheck` — all pass.
2. `npm test` with PostgreSQL enabled — 85 pass, 0 skipped (10 files, incl. the
   12 DB integration tests and the new `admin-web` project). Integration suite
   also re-run against the dev Supabase project — 12/12.
3. `npm run build` for both apps — pass (Next 16.3.4, Turbopack).
4. Production browser smoke test (headless Chromium) with the nonce CSP — Admin
   `/login` + `/`, POS `/login` + `/register`: hydrate, `fetch` works, zero CSP
   violations.
5. `npm audit --omit=dev --audit-level=high` (registry access) — 0
   vulnerabilities.
6. `npm run db:status` against the dev Supabase project — 12 applied, 0 pending.

## P1 — all done

| Item | Status | Where |
|---|---|---|
| Store PIN brute-force protection | **done** | `identity.terminal_pin_attempts` (migration 0008); `store-auth.pinLogin` checks the terminal gate first, counts every failure (no-match, inactive, wrong PIN), runs `verifyDummyPin` for timing, keeps the per-employee lock, audits terminal throttles/locks with no PIN, and returns one generic `invalid`. Test: `integration.test` "locks the terminal after repeated nonexistent-PIN guesses". |
| Dev OTP containment | **done** | `server/dev-session.ts`: requires `NODE_ENV=development` + `ALLOW_INSECURE_DEV_AUTH=true` + non-empty `ADMIN_DEV_OTP`; `assertDevAuthSafe()` refuses a non-loopback base URL; constant-time compare; OTP failure throttle applied to the fixed code; server-side expiry from `issuedAt`; cookie `secure` from the request protocol; nothing logged; red `InsecureAuthBanner`. `.env.example` ships the flags blank. |
| Accountant routing | **done** | `/reports` guarded placeholder (`(app)/reports/page.tsx`), role-aware topbar nav, read-only copy. |
| Real franchise onboarding | **done** | `billing.franchise.manage` capability (0010); `createFranchise` / `listFranchises`; `FranchisePanel` UI with a franchise **select** (no raw UUID); `createFranchiseOwnerInvitation` cancels superseded invitations and blocks internal accounts; `POST /api/v1/invitations/{token}/accept` + `/accept-invitation` page bind acceptance to the invited mobile + OTP; replay rejected. Tests cover wrong-phone, replay, supersede, internal-account. |
| Least-privilege DB boundary | **done** | POS page now uses `getOperatorSummary` under operator RLS context (0009 adds `employee_operator_self` / `opsession_operator_self` policies); ESLint `no-restricted-syntax` blocks raw `.query` in `apps/*/src/app/**`; composite `(<fk>, organization_id)` foreign keys (0009) plus `(<fk>, franchise_id)` / `(franchise_id, brand_id)` foreign keys (0012) make org/franchise/brand IDs on employees, terminals, activation codes, outlets, and memberships mutually consistent. |
| Dependency security | **done** | Upgraded both apps to **Next.js 16.3.4** (resolves the bundled-postcss advisory); `npm audit --omit=dev --audit-level=high` → 0. CI now gates on `high` and runs `format:check`. |

## P2

### Done

- **OTP eligibility** — `eligibleForOtp` gates the Supabase send to known
  invited/active accounts; the response is identical for unknown numbers. Public
  self-registration cannot create or send.
- **OTP send window off-by-one** — `otpSendGate` now blocks at exactly
  `maxSendsPerWindow`, not one over.
- **MSG91 client** — `AbortSignal.timeout(8s)`, redacted `network` / `timeout` /
  `provider_error` results, never logs body / authkey / phone / code.
- **Real fresh authentication** — `identity.account_profiles.last_otp_at`
  (migration 0011) is set only on interactive OTP verification;
  `buildAdminActor` derives `secondsSinceAuth` from it, so token refresh never
  resets the freshness window. Covered by an integration test with a stale
  timestamp against `outletLifecycle`.
- **Request/browser security** — the Edge proxy sets a per-request nonce CSP
  (`script-src 'self' 'nonce-…' 'strict-dynamic'` in production, `frame-ancestors
  'none'`, `upgrade-insecure-requests`); `next.config.mjs` sets the static
  headers `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, HSTS in production, and `Cache-Control: no-store` on
  `/api/*`. The proxy rejects cross-site cookie-authenticated mutations by
  `Origin`. `jsonError` returns a stable `400 validation` for Zod errors and
  never logs request bodies; responses carry `x-correlation-id`.
- **Terminal/operator corrections** — "Not me" calls
  `POST /api/v1/operator-sessions/reject` which ends the session and clears the
  cookie; the admin PIN create/reset UI uses masked `type="password"` inputs and
  an inline validated form (no `prompt()`); terminal enrolment now also checks
  `outlet.billing_enabled` and `brand.is_billing_enabled`.
- **Audit completeness** — `ensureAllowedAudited` writes a `denied` audit event
  in its **own** transaction (via `auditOutOfBand`) before throwing, so denials
  of `outlet.create`, `outlet.lifecycle`, `terminal.enroll`, `terminal.revoke`,
  `pin.reset`, and `account.status_changed` survive the business rollback.
  `audit.events` / `outbox.events` are append-only for `identity_api` (no
  UPDATE/DELETE grant, plus reject triggers).
- **Quality/CI** — Prettier applied repo-wide; `format:check` in CI; official
  `@next/eslint-plugin-next` rules added.

### Deferred — proposed for JKSH approval

| Item | Rationale | When |
|---|---|---|
| Global / per-IP / provider **cost limits** on OTP send | Per-number cooldown + window cap + eligibility check are in place; a global spend cap belongs with the real MSG91 wiring and a metrics backend. | With MSG91 integration |
| **Send SMS hook** endpoint + signature / duplicate / outage / fail-closed tests | MSG91 credentials and template approval are absent by explicit product decision; there is nothing to authenticate against yet. | With MSG91 integration |
| Two-step **resolve → confirm** operator session (session `active` only after name confirm) | The `Not me` reject path already revokes the premature session and clears the cookie; the enum change + POS state machine is a Stage 3 POS concern. | Stage 3 |
| **Activation-code attempt throttling** | Codes are 8 Crockford chars (~10^12 space), single-use, expiring, outlet-bound; brute force is impractical. Edge rate-limiting covers abuse. | Stage 7 hardening |
| Replacement-terminal **receipt-sequence collision** on same business date | Receipt-number allocation does not exist until Stage 3; the constraint will be designed with it. | Stage 3 |
| **Trusted-proxy IP** capture | `requestMeta` only reads `x-forwarded-for` when `TRUST_PROXY=true`; the concrete proxy contract is a deployment decision. | Deployment |
| Separate **runtime vs migration DB credentials** | Supabase's pooler exposes one project login; `set local role identity_api` already narrows every request. A dedicated `identity_api` login is added when the deployment platform supports it. | Deployment |
| Full **Route Handler contract test suite** and **browser smoke tests** | Identity domain + live-Postgres integration + RLS-denial tests cover the logic; a Next Route Handler harness and Playwright suite are their own setup. | Stage 7 hardening |

## Verification (local Postgres 16 + dev Supabase) — 2026-09-04

```
format:check   OK
lint           OK
typecheck      0 errors (6 packages)
test           85 pass, 0 skipped (local Postgres) ; 12/12 integration (Supabase, 0001–0012)
build          both apps (Next 16.3.4, Turbopack)
smoke          headless Chromium, prod nonce CSP — Admin + POS hydrate, 0 CSP violations
audit          0 vulnerabilities (--omit=dev --audit-level=high, registry access)
db:status      Supabase — 12 applied, 0 pending
```
