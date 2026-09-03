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

The repo is clean: `git ls-files | xargs grep -l 'sb_secret'` → none; `.env` is
gitignored; no secret key reaches a browser bundle (server-only imports).

## P1 — all done

| Item | Status | Where |
|---|---|---|
| Store PIN brute-force protection | **done** | `identity.terminal_pin_attempts` (migration 0008); `store-auth.pinLogin` checks the terminal gate first, counts every failure (no-match, inactive, wrong PIN), runs `verifyDummyPin` for timing, keeps the per-employee lock, audits terminal throttles/locks with no PIN, and returns one generic `invalid`. Test: `integration.test` "locks the terminal after repeated nonexistent-PIN guesses". |
| Dev OTP containment | **done** | `server/dev-session.ts`: requires `NODE_ENV=development` + `ALLOW_INSECURE_DEV_AUTH=true` + non-empty `ADMIN_DEV_OTP`; `assertDevAuthSafe()` refuses a non-loopback base URL; constant-time compare; OTP failure throttle applied to the fixed code; server-side expiry from `issuedAt`; cookie `secure` from the request protocol; nothing logged; red `InsecureAuthBanner`. `.env.example` ships the flags blank. |
| Accountant routing | **done** | `/reports` guarded placeholder (`(app)/reports/page.tsx`), role-aware topbar nav, read-only copy. |
| Real franchise onboarding | **done** | `billing.franchise.manage` capability (0010); `createFranchise` / `listFranchises`; `FranchisePanel` UI with a franchise **select** (no raw UUID); `createFranchiseOwnerInvitation` cancels superseded invitations and blocks internal accounts; `POST /api/v1/invitations/{token}/accept` + `/accept-invitation` page bind acceptance to the invited mobile + OTP; replay rejected. Tests cover wrong-phone, replay, supersede, internal-account. |
| Least-privilege DB boundary | **done** | POS page now uses `getOperatorSummary` under operator RLS context (0009 adds `employee_operator_self` / `opsession_operator_self` policies); ESLint `no-restricted-syntax` blocks raw `.query` in `apps/*/src/app/**`; composite `(<fk>, organization_id)` foreign keys (0009) make org/franchise/brand IDs on employees, terminals, activation codes, and memberships consistent. |
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
- **Request/browser security** — `next.config.mjs` sets CSP (`frame-ancestors
  'none'`), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, HSTS in production, and `Cache-Control: no-store` on
  `/api/*`. Middleware rejects cross-site cookie-authenticated mutations by
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

## Verification (local Postgres 16 + dev Supabase)

```
format:check   OK
lint           OK
typecheck      0 errors (6 packages)
test           78 unit + integration (local) ; 73 (Supabase)
build          both apps (Next 16)
audit          0 vulnerabilities (--omit=dev --audit-level=high)
```
