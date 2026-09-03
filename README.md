# JKSH Platform

Clean-sheet Billing and Stock platform for JKSH brands. TVANAMM is the first
Billing brand. Billing and Stock are separate systems connected through versioned
events and APIs.

## Workspace

- `apps/admin-web` — Next.js app for Central Admin, Accountant, Franchise Owner
  (`admin.jkshunited.com`).
- `apps/pos-web` — Next.js Store Billing terminal, PWA in Stage 3
  (`billing.jkshunited.com`).
- `packages/contracts` — shared versioned zod contracts (API, events, capabilities).
- `packages/config` — browser-safe vs server-only environment validation.
- `packages/db` — Supabase clients, `pg` pool, migration runner.
- `packages/identity` — identity + authorization domain: mobile OTP admin login,
  terminal enrollment, four-digit PIN store login, sessions, capability engine,
  audit. Consumed by both apps' Route Handlers (the secure API boundary).
- `database/identity` — committed PostgreSQL migrations.
- `docs` — product, workflow, and architecture decisions. Start with
  `docs/architecture/stage-1-implementation.md`.

## Prerequisites

- Node 22+, npm 10+.
- A Postgres database. Either a Supabase project or, for local work,
  `docker compose -f docker-compose.test.yml up -d`.

## Setup

```bash
npm install
cp .env.example .env          # fill in Supabase + MSG91 values
npm run db:migrate            # apply database/identity/*.sql
npm run db:seed               # reference data + optional BOOTSTRAP_* login accounts
```

Copy `.env` values as needed. Never put `SUPABASE_SECRET_KEY`, `DATABASE_URL`,
`MSG91_AUTHKEY`, or `IDENTITY_TOKEN_SECRET` into a `NEXT_PUBLIC_*` variable.

Without `MSG91_AUTHKEY` / `MSG91_OTP_TEMPLATE_ID`, development and CI use a fixed
`OTP_FAKE_CODE` (default `1234`) and send no SMS.

## Commands

```bash
npm run dev:admin        # admin-web on :3000
npm run dev:pos          # pos-web on :3001
npm run db:migrate       # apply pending migrations (uses DIRECT_URL)
npm run db:status        # show applied / pending migrations
npm run db:seed          # migrate + reference data + dev bootstrap accounts
npm run typecheck
npm test                 # vitest; DB integration tests run when DATABASE_URL is set
npm run lint
npm run build
```

## Stage 1 status

Foundation and Identity is implemented and verified end to end:

- Mobile SMS OTP admin login (MSG91), workspace resolution and selector,
  session cookies with revocation, session list.
- Franchise Owner terminal enrollment (one active terminal per outlet,
  replace-on-register), revocable hashed terminal credentials.
- Store Employee creation (name + phone → generated `EMP-…` id), Franchise
  Owner-assigned four-digit PIN, outlet-local PIN uniqueness, four-digit PIN
  login with name confirmation, per-employee and per-terminal throttle + lockout.
- Capability + scope authorization engine enforced in every Route Handler;
  fresh-OTP step-up for PIN reset and terminal revoke.
- Append-only `audit.auth_events` written in the same transaction as each action.
- 90 automated tests (unit + Postgres integration), lint, typecheck, and both
  Next.js builds pass.
