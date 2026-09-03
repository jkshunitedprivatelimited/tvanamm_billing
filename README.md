# JKSH Platform

Clean-sheet Billing and Stock platform for JKSH brands. TVANAMM is the first
Billing brand. Billing and Stock are separate systems connected through versioned
events and APIs.

## Workspace

- `apps/admin-web` — Next.js app for Central Admin, Accountant, Franchise Owner
  (`admin.jkshunited.com`).
- `apps/pos-web` — Next.js Store Billing terminal, PWA in Stage 3
  (`billing.jkshunited.com`).
- `packages/contracts` — versioned zod contracts + the capability registry.
- `packages/config` — browser-safe vs server-only environment validation.
- `packages/db` — `pg` pool, the RLS `withActorContext` transaction wrapper,
  Supabase clients, and the migration runner.
- `packages/identity` — identity + authorization domain: Supabase Auth mobile OTP
  resolution, outlet lifecycle, terminal enrollment, four-digit PIN operator
  login, capability engine, audit. Consumed by both apps' `/api/v1` handlers.
- `database/migrations` — one ordered, committed migration list
  (`docs/plans/billing-data-api-plan.md` §13).
- `docs` — product, workflow, and architecture decisions. Start with
  `docs/architecture/stage-1-implementation.md`.

## Prerequisites

- Node 22+, npm 10+.
- A Postgres database: a Supabase project, or locally
  `docker compose -f docker-compose.test.yml up -d`.

## Setup

```bash
npm install
cp .env.example .env           # fill Supabase + MSG91 values
npm run db:migrate             # apply database/migrations/*.sql (uses DIRECT_URL)
npm run db:seed                # reference data + demo outlet + optional BOOTSTRAP_* accounts
```

Admin login is **Supabase Auth phone OTP**; MSG91 is only the SMS carrier, wired
as Supabase's **Send SMS** auth hook (`MSG91_AUTHKEY` / `MSG91_SMS_TEMPLATE_ID`).
MSG91 is **not integrated yet** by explicit product decision.

For local development only, a fixed-code bypass is available. It requires **all
three** of `NODE_ENV=development`, `ALLOW_INSECURE_DEV_AUTH=true`, and a non-empty
`ADMIN_DEV_OTP`, refuses to run on a non-loopback URL, and shows a red
non-production banner. Any seeded account's mobile plus `ADMIN_DEV_OTP` signs in
with no SMS and no Supabase Auth. Leave the flags blank in shared config.

Never put `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `MSG91_AUTHKEY`, or
`IDENTITY_TOKEN_SECRET` into a `NEXT_PUBLIC_*` variable.

## Commands

```bash
npm run dev:admin        # admin-web on :3000
npm run dev:pos          # pos-web on :3001
npm run db:migrate       # apply pending migrations
npm run db:status        # applied / pending migrations
npm run db:seed          # migrate + reference data + dev bootstrap
npm run typecheck
npm test                 # vitest; DB integration tests run when DATABASE_URL is set
npm run lint
npm run build
```

## Stage 1 status

Foundation and Identity, re-aligned to `docs/plans/billing-data-api-plan.md`:

- `identity` / `billing` / `audit` / `outbox` schemas; least-privilege
  `identity_api` role with **enforced RLS** — every request runs in a
  `set local role identity_api` transaction with an `app.*` authorization
  context. Cross-tenant reads/writes are denied by policy.
- Supabase Auth mobile OTP admin login (MSG91 as the SMS sender), workspace
  resolution + selector, logout / logout-all.
- Franchise-Owner invitations, employee create / update / disable / reactivate /
  reset-PIN, Central-Admin account status changes.
- Central-Admin-only outlet creation and `draft → active → suspended → closed`
  lifecycle; suspending revokes the terminal. One active terminal per outlet with
  replace-on-register. Store Employee four-digit PIN operator login with
  throttle + lockout.
- Append-only `audit.events` written in each action's transaction; denied
  sensitive commands are audited out of band.
- Audit remediation applied (`docs/plans/stage-1-remediation-status.md`):
  terminal-wide PIN throttling, contained dev OTP, real fresh-auth timestamps,
  franchise/invitation onboarding, operator RLS reads + tenant-ID constraints,
  CSP/security headers, cross-site mutation guards, and Next.js 16.
- 78 automated tests (unit + Postgres integration, verified against both a local
  Postgres and the dev Supabase project); `format:check`, lint, typecheck, both
  Next.js builds, and `npm audit --omit=dev --audit-level=high` pass.
