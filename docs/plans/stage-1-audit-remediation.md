# Stage 1 Audit Remediation Plan

Status: Required before Stage 1 acceptance and before Billing Stage 2 begins.

This plan converts the post-implementation audit of commit `26ebe07` into an
ordered coding checklist. It does not expand Billing V1 product scope. Complete
the work in priority order and preserve the confirmed workflows in `docs/`.

## Completion Rule

Stage 1 is accepted only when:

- every P0 and P1 item below is implemented and tested;
- every P2 item is implemented or has an explicit documented deferral approved
  by JKSH;
- unit and live Postgres integration tests pass;
- typecheck, lint, formatting, dependency audit, and both production builds pass;
- the development OTP path cannot operate in a production or public deployment;
- leaked Supabase credentials have been replaced and revoked outside source
  control.

## P0: Credential Incident

Owner: JKSH account holder plus deployment operator.

### Database password

1. Reset the Billing development project's database password in Supabase.
2. Replace the password in both `DATABASE_URL` and `DIRECT_URL` in local and
   deployment secret stores.
3. Restart every service holding a pooled database connection.
4. Run migration status and the live integration suite using the new password.
5. Confirm the old password no longer connects.

### Supabase secret key

1. Create a new named `sb_secret_...` key for the admin backend.
2. Replace `SUPABASE_SECRET_KEY` in local and deployment secret stores.
3. Verify account disable/global sign-out with the new key.
4. Delete the leaked secret key only after the new deployment passes.
5. Confirm no secret key is present in tracked files, build artifacts, logs, or
   client bundles.

Never paste replacement credentials into chat, issues, commits, or screenshots.
The publishable key is not a secret and does not need incident rotation unless
its permissions/configuration are wrong.

## P1: Store PIN Brute-Force Protection

Problem: a PIN with no matching `pin_lookup` does not increment an employee
counter, allowing enumeration of the 10,000-value PIN space using a stolen
terminal credential.

Implementation:

1. Add persistent terminal-level attempt state: failure count, last failure,
   lock time, and window start, or a dedicated rate-limit table keyed by terminal.
2. Check the terminal gate before looking up any employee.
3. Count every failed PIN attempt, including `no_match`, malformed, inactive
   employee, and failed Argon2 verification where appropriate.
4. Use a dummy Argon2 verification when no employee matches to reduce timing
   differences between valid and invalid PIN candidates.
5. Retain the employee-specific lockout in addition to the terminal gate.
6. Apply per-IP throttling at the deployment edge as defense in depth; do not
   trust `x-forwarded-for` unless the proxy overwrites it.
7. Return one generic invalid-PIN response except when the terminal itself is
   revoked or the outlet is inactive.
8. Audit terminal soft throttles and hard locks without storing attempted PINs.

Tests:

- repeated nonexistent PINs lock the terminal;
- rotating nonexistent guesses cannot bypass throttling;
- attempts against a real employee also affect terminal and employee counters;
- success resets only the intended counters;
- concurrent attempts cannot exceed the threshold due to a race;
- audit metadata contains no PIN or terminal credential.

## P1: Temporary Development OTP Containment

Temporary fixed OTP is allowed for local testing until MSG91 is integrated.

Implementation:

1. Keep `ADMIN_DEV_OTP` empty in `.env.example`; document a local example without
   installing a working default.
2. Require all of the following to enable the bypass:
   `NODE_ENV=development`, an explicit `ALLOW_INSECURE_DEV_AUTH=true`, and a
   non-empty `ADMIN_DEV_OTP`.
3. Refuse startup when insecure auth is enabled with a non-loopback/public base
   URL or in a production build/runtime.
4. Apply the normal OTP failure throttling to the fixed-code verification route.
5. Use constant-time comparison for the configured OTP.
6. Enforce development-session expiry on the server using `issuedAt`, not only
   browser cookie `maxAge`.
7. Set the development cookie `secure` from the actual protocol/environment and
   keep it `httpOnly` and `sameSite=lax` or stricter.
8. Never log the fixed OTP, submitted code, phone, session body, or cookie.
9. Add a visible non-production banner while development auth is enabled.
10. Add tests proving the bypass is disabled in production regardless of other
    variables.

The temporary bypass is removed completely when Supabase Phone Auth plus MSG91
is accepted.

## P1: Accountant Routing

Problem: Accountant login redirects to `/reports`, but that page does not exist.

Implementation:

1. For Stage 1, route Accountant to an existing guarded placeholder workspace,
   or add `/reports` as a guarded placeholder.
2. The page must show no outlet/user management controls.
3. Keep Accountant read-only except for the future append-only accounting
   adjustment command.
4. Add route tests for direct login, workspace selection, and forbidden admin
   navigation.

Do not implement Stage 6 financial reports as part of this repair.

## P1: Real Franchise Onboarding Path

Implementation:

1. Add Central-only franchise creation/listing APIs and a usable selector; never
   require Central to type a raw franchise UUID.
2. Add the Central UI to create a Franchise Owner invitation.
3. Add an invitation acceptance route and page using the existing single-use,
   expiring token domain function.
4. Bind acceptance to the invited mobile and successful phone verification.
5. Expire/cancel superseded invitations and prevent replay.
6. Prevent accidentally granting a Franchise Owner membership to an internal
   Central/Accountant account unless an explicit future policy allows it.
7. Add tests for expired, replayed, wrong-phone, cross-organization, and existing
   account cases.

Bootstrap accounts remain development-only and are not the production onboarding
workflow.

## P1: Least-Privilege Database Boundary

Implementation:

1. Remove the direct unrestricted `db().query` call from the POS page. Load the
   employee/outlet summary through an identity function using operator context.
2. Add an ESLint restriction preventing application files from calling the raw
   pool except approved database/CLI modules.
3. Use separate runtime and migration credentials where Supabase permits it.
   Runtime code must not connect as the schema owner when a narrower login role
   is available.
4. Add composite integrity constraints or triggers ensuring duplicated
   organization/franchise/outlet IDs on employees, terminals, activation codes,
   memberships, and future financial records cannot disagree.
5. Add denial tests at the Route Handler and database-policy layers.

## P1: Dependency Security

Current audit: a vulnerable PostCSS version is bundled through Next.js, with one
high and one moderate advisory.

Implementation:

1. Create a branch for the supported Next.js upgrade that resolves the advisory;
   do not use `npm audit fix --force` blindly.
2. Review the Next.js migration guide and breaking changes.
3. Upgrade both Next.js applications together and keep React versions aligned.
4. Rerun unit/integration tests, lint, typecheck, both builds, and smoke tests.
5. Change CI to fail on `high`, not only `critical`, after the upgrade.
6. Document any temporary advisory exception with advisory ID, exposure analysis,
   owner, and expiry date.

## P2: OTP Eligibility and MSG91 Preparation

Before real SMS is enabled:

1. Check whether a normalized phone belongs to an invited/active eligible account
   before requesting Supabase OTP, while returning the same generic response for
   eligible and unknown numbers.
2. Do not create/send for public self-registration.
3. Correct the send-window off-by-one so `maxSendsPerWindow=5` sends at most five,
   not six.
4. Add global/IP/provider cost limits in addition to per-number limits.
5. Add network timeout, retry classification, and redacted provider errors to the
   MSG91 client.
6. Implement and authenticate the Supabase Send SMS hook endpoint only when MSG91
   credentials and template approval are ready.
7. Test hook signature verification, duplicate delivery, provider outage, and
   production fail-closed behavior.

MSG91 credentials remain absent for now by explicit product decision.

## P2: Real Fresh Authentication

Problem: access-token refresh time is not proof that the user recently completed
an OTP challenge.

Implementation:

1. Persist or cryptographically bind the timestamp of the latest interactive OTP
   verification.
2. Do not refresh that timestamp during automatic access-token refresh.
3. Require a new OTP challenge when a sensitive operation exceeds the 15-minute
   freshness window.
4. Cover PIN reset, terminal enroll/revoke, outlet lifecycle, and account status
   changes.
5. Add tests using refreshed tokens whose last interactive authentication is old.

## P2: Request and Browser Security

1. Enforce allowed origins on every cookie-authenticated mutation.
2. Reject cross-site JSON/form requests before domain code executes.
3. Add security headers to both apps: CSP, `frame-ancestors`, content-type
   protection, referrer policy, permissions policy, and production HSTS.
4. Keep financial/auth responses non-cacheable.
5. Convert invalid JSON/Zod input into stable `400 validation` responses rather
   than generic `500` errors.
6. Ensure error logs never include OTPs, PINs, terminal credentials, auth cookies,
   payment references, or raw bodies.
7. Add request correlation IDs to responses and audit records.

## P2: Terminal and Operator Corrections

1. When the employee selects `Not me`, revoke the newly created operator session
   and clear its cookie before returning to PIN entry.
2. Prefer a two-step resolve/confirm flow so the operator session becomes active
   only after confirming the displayed employee name.
3. Mask PIN entry in the employee create/reset UI and replace browser `prompt()`
   with a validated form.
4. Add activation-code attempt throttling and generic failure responses.
5. Verify replacement-terminal receipt sequencing cannot collide on the same
   business date when `T01` is reused.
6. Check outlet `billing_enabled` and brand `is_billing_enabled` consistently
   before terminal operation and future bill creation.

## P2: Audit Completeness

1. Audit denied sensitive commands as well as successful commands.
2. Preserve denial audit events even when the business transaction rolls back.
3. Store trusted proxy-derived IP/device context where useful, with retention and
   redaction rules.
4. Add tests for denied cross-franchise actions, stale authentication, throttles,
   and session revocation.
5. Keep audit and outbox records append-only for application roles.

## P2: Quality, Documentation, and CI

1. Run Prettier and make `npm run format:check` pass.
2. Add `format:check` to CI.
3. Add the official Next.js ESLint configuration so framework-specific rules run.
4. Add Route Handler tests for auth, cookies, authorization, validation, and
   response contracts.
5. Add browser smoke tests for Central, Accountant, Franchise Owner, terminal
   enrollment, PIN login, lock/logout, and `Not me`.
6. Update README and Stage 1 documentation to describe temporary development OTP
   accurately; do not claim MSG91 is wired before it is.
7. Update the master checklist only when implementation plus automated tests are
   complete.

## Required Verification Commands

Run serially from the repository root:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

Then, using development Supabase secrets from a secure local/deployment store:

```bash
npm run db:status
# Run the full suite with DATABASE_URL loaded so DB integration tests do not skip.
```

Record the count of unit, integration, Route Handler, and browser tests separately.
A suite that silently skips database tests is not an acceptance pass.

## Stage 1 Acceptance Scenarios

- Central, Accountant, and Franchise Owner reach valid role-specific workspaces.
- Unknown public phone numbers cannot trigger an SMS or create application access.
- Temporary OTP works locally and is impossible in production.
- A revoked/suspended account or membership loses access immediately.
- Nonexistent PIN guessing triggers terminal lockout.
- Cross-franchise reads/writes are denied through both API and RLS.
- Central creates a franchise, invites its owner, and the owner accepts once.
- Owner creates an employee, enrolls one terminal, and employee confirms identity
  before an operator session becomes active.
- `Not me`, lock, logout, terminal replacement, employee disable, and outlet
  suspension revoke exactly the intended sessions.
- No application request bypasses the actor-context database boundary.
- Leaked database and Supabase secret credentials no longer work.
- Current tracked source, history scan, logs, and browser bundles contain no
  privileged credentials.

## After Acceptance

After this plan passes, continue with the complete implementation specification
in `docs/plans/billing-v1-build-plan.md`. Its delivery order is:

1. Stage 2: Catalog and immutable outlet menu publication.
2. Stage 3: POS, transactional checkout, shifts, cash session, and offline outbox.
3. Stage 4: Receipt printing and bill history.
4. Stage 5: full/partial refunds and day-close rules.
5. Stage 6: dashboards, Accountant adjustments, exports, and retention jobs.
6. Stage 7: security hardening, load testing, pilot, and Billing V1 release gate.
