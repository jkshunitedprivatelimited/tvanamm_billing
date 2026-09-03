# Stage 1 Implementation Architecture

Status: Accepted. Governs the Stage 1 build ("Foundation and Identity") from
`docs/plans/billing-mvp-execution.md` and sections 1-4 of
`docs/checklists/billing-system.md`.

This record captures the concrete choices made when the frontend moved from Vite
to Next.js. It does not change any product decision in `billing-actors.md`,
`advanced-login.md`, `billing-shifts.md`, or `platform-decisions.md`.

## Decisions

### D1. Two Next.js applications, shared packages

- `apps/admin-web` — Next.js App Router. Serves `admin.jkshunited.com`.
  Central Admin, Accountant, Franchise Owner.
- `apps/pos-web` — Next.js App Router (PWA shell added in Stage 3). Serves
  `billing.jkshunited.com`. Store terminals and Store Employees.
- Shared workspace packages:
  - `@jksh/contracts` — versioned zod schemas for API input/output and events.
  - `@jksh/config` — environment validation, split into browser-safe and
    server-only schemas.
  - `@jksh/db` — Supabase client factories, a `pg` pool for privileged work, and
    the SQL migration runner.
  - `@jksh/identity` — the identity/authorization domain: capability engine,
    membership resolution, terminal enrollment, PIN lifecycle, session and audit
    writes. Pure logic is isolated from IO so it is unit-testable.

### D2. API boundary = Next.js server code calling `@jksh/identity`

`platform-decisions.md` requires that "browser applications do not orchestrate
privileged table mutations" and that identity/authorization sits "behind secure
TypeScript API services". A standalone Fastify service is **not** run for Stage 1.
Instead:

- Every privileged operation is a Route Handler (`app/api/**/route.ts`) that runs
  only on the server and calls `@jksh/identity`.
- Data access is a pooled `pg` connection over the server-only `DATABASE_URL`
  (transaction-mode pooler at runtime, `DIRECT_URL` for migrations). The Supabase
  **secret key** is available for auth-provider / storage use later. None of
  these are imported into a Client Component or exposed through `NEXT_PUBLIC_*`.
- `serverExternalPackages` keeps `pg` and `@node-rs/argon2` out of the bundle;
  the migration runner is imported only from `@jksh/db/migrate` so its
  filesystem read of `database/` never reaches an app bundle.
- `@jksh/identity` derives organization / franchise / outlet / role / permissions
  from the validated session row. Request bodies never carry authorization facts.
- The same domain package is consumed by both apps, so there is exactly one
  implementation of authorization, terminal, PIN, session, and audit logic.

If load or team boundaries later require an independently deployable identity
service, `@jksh/identity` lifts out unchanged behind a Fastify adapter.

### D3. Supabase for Postgres; MSG91 for admin OTP

- Supabase hosts Postgres (one Billing project per environment; the two Next.js
  apps share it). Schemas: `identity`, `audit`, plus `billing` / `outbox` in
  later stages.
- Admin login (`/admin/login`) is **mobile number + SMS OTP via MSG91**, the
  confirmed primary (and only) factor for Central Admin, Accountant, and
  Franchise Owner. No TOTP/passkey for the MVP.
  - `@jksh/identity` talks to a pluggable `OtpProvider`; `Msg91OtpProvider` is
    the real one, `FakeOtpProvider` (fixed `OTP_FAKE_CODE`) covers dev and CI.
  - MSG91 owns code generation, delivery, and verification. `@jksh/identity`
    owns account resolution, session issue, `otp_attempts` throttling
    (resend cooldown, per-window send cap, verify-failure lock), and audit.
  - Supabase Auth is **not** used for admin login. `identity.users` is the
    identity source of truth; `identity.users.phone` (unique where
    `has_auth_login`) is the login key. `auth_user_id` is a reserved column for
    an optional future link.
- Store Employees are **not** auth-provider users. A Franchise Owner creates them
  from name + phone (generated `EMP-…` id) and assigns the initial four-digit
  PIN. Daily store login is PIN-only on a registered terminal.
- Public self-registration is disabled. Central Admin creates Franchise Owner
  accounts and memberships; a one-time invitation (`identity.invitations`) plus
  OTP activates the account.

### D4. Migrations: committed SQL + a small runner

- `database/identity/NNNN_name.sql` — forward-only, numbered, committed.
- `@jksh/db` migration runner applies pending files in order inside a
  transaction and records them in `identity.schema_migrations`.
- The runner targets any Postgres via `DATABASE_URL`, so CI runs the full schema
  against a Postgres service container and integration tests run there too.
- Supabase project database is migrated by pointing the same runner at the
  Supabase connection string.

### D5. Three session concepts, three records

Per `advanced-login.md`:

- **Authentication session** (`identity.sessions`): proves the account. Created
  on admin OTP verify and on PIN login. Carries idle + absolute expiry,
  `authenticated_at` (drives fresh-auth step-up checks), device info, and a
  hashed opaque cookie token. Revoked immediately on logout, account disable, or
  permission change.
- **Workstation session** (`identity.workstation_sessions`): binds a registered
  terminal + outlet + current operator. `Lock terminal` keeps it and hides POS
  data; `Logout` ends it and clears local data. One open workstation session per
  terminal; a new operator's PIN login ends the previous one.
- **Shift session**: deferred. Not part of the Stage 1 exit criteria. Table and
  code land in Stage 3 / Stage 5.

### D7. Terminals

- **One active Billing terminal per outlet** (`advanced-login.md`). Registering a
  replacement revokes the previous terminal, its credential, and any open
  workstation session. Terminal *records* (not single-device columns) are used
  so multi-terminal support is a later additive change.
- `identity.terminal_credentials`: hashed, revocable, rotatable. The device
  holds an opaque HMAC-signed bearer credential; the server stores only
  `sha256(nonce)` and verifies the signature before any DB lookup.
- Activation codes are one-time, outlet-bound, hashed, and expiring.
- Audit events (`audit.auth_events`) are append-only, enforced by a trigger that
  rejects UPDATE/DELETE.

### D6. Authorization

- A fixed capability registry (`@jksh/identity/capabilities`).
- `authorize(actor, capability, resourceScope, context)` — pure function.
  Allows only when: session active AND account active AND membership scope
  contains the requested organization/franchise/outlet AND the actor's role
  grants the capability AND contextual policy passes.
- Enforced in every Route Handler. Frontend guards are navigation/UX only.
- Row Level Security is enabled on tenant tables as defense-in-depth. App-layer
  capability checks are the tested, authoritative control for Stage 1.

## Stage 1 exit mapping

| Exit requirement | Where |
|---|---|
| Central Admin enters only its workspace | `resolveMemberships` + `/admin` route guard |
| Accountant enters only financial workspace | membership role `accountant`, read capabilities only |
| Franchise Owner sees one card per authorized outlet | `/admin` workspace selector, `listWorkspaceCards` |
| Store Employee reaches only the assigned outlet | PIN login resolves single outlet membership; no outlet picker |
| Terminal enrollment | `/admin` activation code issue + `/store` code redemption |
| Four-digit PIN login, throttling, lockout | `@jksh/identity/pin` + `pin_attempts` + `/store/login` |
| Logout, session revocation | `identity.sessions` + `/api/session` handlers |
| Audit events | `identity.auth_audit_events`, written in the same transaction as the action |
