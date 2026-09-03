# Stage 1 Implementation Architecture

Status: Accepted. Governs the Stage 1 build ("Foundation and Identity") and is
the concrete realization of `docs/plans/billing-data-api-plan.md` §1-4, §10,
§13-14, plus `advanced-login.md`, `outlet-onboarding.md`, and `billing-actors.md`.

## Decisions

### D1. Two Next.js apps, shared packages

- `apps/admin-web` (Next.js App Router) — `admin.jkshunited.com`. Central Admin,
  Accountant, Franchise Owner.
- `apps/pos-web` (Next.js App Router, PWA in Stage 3) — `billing.jkshunited.com`.
  Store terminals and Store Employees.
- Packages: `@jksh/contracts` (versioned zod schemas + capability registry),
  `@jksh/config` (browser vs server env), `@jksh/db` (`pg` pool, RLS
  `withActorContext`, migration runner), `@jksh/identity` (the identity /
  authorization domain).

### D2. API = Next.js Route Handlers under `/api/v1/*`

The endpoint set follows `billing-data-api-plan.md` §10. Every privileged
operation is a server Route Handler that resolves the actor and calls
`@jksh/identity`. No standalone Fastify service for Stage 1; `@jksh/identity`
lifts out behind one later if needed.

### D3. Supabase Auth phone OTP; MSG91 delivers the SMS

- Admin/Owner login is **Supabase Auth mobile OTP**. Supabase owns `auth.users`,
  code generation, verification, and the JWT session (cookie-based via
  `@supabase/ssr`).
- **MSG91** is wired as Supabase's "Send SMS" auth hook — it only puts the code
  into an SMS. `@jksh/identity/sms-sender` has the MSG91 client; a `LogSmsSender`
  covers local dev.
- `identity.account_profiles` links `auth.users.id` to the application identity.
  Central Admin pre-creates the account (`invited`); the first successful OTP
  links `auth_user_id` and flips it to `active`. Public self-registration is off.
- The selected workspace is a signed `jksh_ws` cookie (`membershipId` + HMAC);
  there is no server session row for admins.
- Store Employees are **not** auth-provider users. Four-digit PIN on a registered
  terminal issues an `identity.operator_sessions` row + a `jksh_op` cookie token.

### D4. Least-privilege database access

- Schemas: `identity`, `billing`, `audit`, `outbox`
  (`billing-data-api-plan.md` §1). Org / brand / franchise / outlet live in
  `billing`.
- Migration 0001 creates roles `identity_api`, `billing_api`, `job_worker`
  (NOLOGIN) and grants them to the connecting role.
- Every request runs in `withActorContext(pool, ctx, fn)`: `begin` →
  `set local role identity_api` → `set_config('app.*', …, true)` for
  request kind / account / role / org / franchise / outlet / operator →
  `fn` → `commit`. So RLS and table grants apply to normal request handling; the
  unrestricted owner is used only for migrations.
- `app.request` = `system` | `admin` | `operator`. `system` is a trusted
  pre-authentication mode used only by OTP link, PIN login, terminal
  registration, and invitation acceptance.
- RLS policies (0005/0006) scope every identity + billing tenant table by those
  GUCs. Integration tests assert cross-tenant denial (`Denied` or
  `row-level security policy`).

### D5. Authorization

- Capability registry in `@jksh/contracts`; `identity.capabilities` /
  `identity.role_capabilities` mirror it (a test asserts equality for the three
  membership roles). `store_employee` is TS-only — no membership row.
- `authorize(actor, capability, scope, policy)` — pure. Allows only when the
  session is active, the account is active, the scope contains the request, the
  role grants the capability, and the contextual policy passes
  (`requireFreshAuthWithinSeconds` for PIN reset, terminal enroll/revoke, outlet
  lifecycle, account status changes).

### D6. Outlets

- Only `central_admin` creates outlets and drives the lifecycle
  `draft → active → suspended → active | closed`
  (`billing.outlet.create` / `billing.outlet.lifecycle`).
- Franchise Owner may edit permitted config fields (`billing.outlet.manage`) but
  never create or change lifecycle.
- `jksh_owned` outlets have no franchise; Central enrolls their terminal.
- Suspending or closing an outlet revokes its active terminal + credential and
  ends open operator sessions in the same transaction.
- One active terminal per outlet; registering a replacement revokes the previous.
- GSTIN is optional and never blocks activation.

### D7. Employees

- Franchise Owner (or Central) creates a Store Employee from name + mobile
  (generated `EMP-…` code), assigns the initial four-digit PIN, and can update,
  reset the PIN (fresh-auth required), or set status
  `active | suspended | disabled`. A non-active status ends live operator
  sessions.
- Outlet-local PIN uniqueness is enforced by a deterministic keyed lookup
  (`hmac(secret, outletId:pin)`) with a unique index; the argon2id hash verifies.

## Stage 1 exit mapping

| Requirement | Where |
|---|---|
| Only the authorized workspace | `buildAdminActor` + `/(app)` guard; `resolveAdminRouting` |
| Central creates outlets; owners cannot | `billing.outlet.create` + `outlet_insert` RLS |
| Outlet lifecycle + suspend→revoke terminal | `outletLifecycle` |
| Terminal enrollment / replacement / revoke | `@jksh/identity/terminal` + `terminals_outlet_one_active` |
| Four-digit PIN login, throttle, lockout | `pin.ts` + `store_employees.failed_attempts/lock_time` |
| Employee disable / reactivate | `setEmployeeStatus` |
| Logout / logout-all / session revocation | Supabase `signOut` + `auth.admin.signOut`; operator session end |
| Audit events | `audit.events`, append-only, written in the action's transaction |

## D8. Audit remediation (post-`26ebe07`)

Applied per `docs/plans/stage-1-audit-remediation.md`; see
`docs/plans/stage-1-remediation-status.md` for the item-by-item state.

- **Store PIN brute force** — `identity.terminal_pin_attempts` (migration 0008)
  is a terminal-wide counter checked before any employee lookup, so a stolen
  terminal credential cannot enumerate the PIN space. Every failure (no match,
  inactive, wrong PIN) increments both the terminal and, where known, the
  employee counter; `verifyDummyPin` equalizes timing; the response is a single
  generic `invalid` except for `terminal_revoked` / `outlet_inactive`.
- **Dev OTP** — the fixed-code admin bypass now requires
  `NODE_ENV=development` + `ALLOW_INSECURE_DEV_AUTH=true` + `ADMIN_DEV_OTP`, is
  refused on a non-loopback base URL, throttled, constant-time, server-expired,
  and shown behind a non-production banner. It is not a production code path.
- **Fresh authentication** — `identity.account_profiles.last_otp_at` (0011) is
  set only on interactive OTP verification and drives `secondsSinceAuth`; token
  refresh never moves it. Enforced for outlet lifecycle, terminal
  enroll/revoke, PIN reset, and account status.
- **Franchise onboarding** — `billing.franchise.manage` (0010); Central creates
  franchises and issues single-use, expiring, mobile-bound invitations that
  supersede prior ones and reject internal accounts; `/accept-invitation`
  consumes them after OTP.
- **DB boundary** — operator RLS read policies + composite `(<fk>,
  organization_id)` foreign keys (0009); an ESLint rule blocks raw pool queries
  in app pages/handlers; the POS page reads through `getOperatorSummary`.
- **Transport** — CSP + security headers and `/api` `no-store` via
  `next.config.mjs`; middleware rejects cross-site cookie mutations by `Origin`;
  Zod failures return `400 validation`; denied sensitive commands are audited
  out of band so the record survives rollback.
- **Dependencies** — both apps on **Next.js 16**; `npm audit --omit=dev
  --audit-level=high` is clean and gated in CI alongside `format:check`.
