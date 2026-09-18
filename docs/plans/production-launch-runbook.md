# Production Launch Runbook

## Scheduling and Objective

- No calendar deadline is assumed.
- Planning continues until the complete functional scope and implementation
  evidence are reviewed.
- Rehearsal and launch dates are assigned only after every enabled path passes
  the gates in this document.

The first release begins with one controlled real-outlet pilot. Broader franchise
rollout begins only after the pilot gates in this document pass. A feature that
misses a hard gate stays disabled behind configuration; it is not represented as
ready.

## 1. Launch Scope and Environments

### Initial enabled scope

- Central Admin, Accountant, Franchise Owner, and Store Employee access;
- outlet/terminal/employee onboarding;
- menu publication and GST-inclusive outlet pricing;
- employee shift and shared Cash session;
- Cash and external-scanner UPI billing;
- discounts with internal reason and actor attribution;
- receipt printing/reprinting;
- bill history and same-day full/partial refund;
- Billing financial dashboard required for reconciliation;
- Stock opening count and inward if the Stock release gates pass;
- JKSH Stock ordering/Razorpay only if its complete payment and fulfilment gates
  pass; otherwise keep the module visibly unavailable, never mocked as paid.

### Deferred/feature-flagged when incomplete

- full offline PWA client when only the offline backend contract is verified;
- unstandardized SOP recipe consumption;
- automated recommendation conversion when its explanation/reconciliation tests
  are incomplete;
- large exports, nonessential analytics, and cosmetic administration features.

### Environment topology

- Development/staging reuses dedicated non-production Billing and Stock projects
  with test data and provider test keys.
- Production has one Billing Supabase project and a physically separate Stock
  Supabase project.
- POS and Admin use the same Billing backend per environment.
- The shared Admin portal calls Billing and Stock through separate API/repository
  boundaries and separate bounded database pools.
- Production, test, and development provider secrets are never interchangeable.
- `billing.jkshunited.com` is the Store PWA; `admin.jkshunited.com` is the
  Central/Accountant/Franchise Owner portal.

### Hard go/no-go gates

Go only when all enabled paths have:

- clean forward migrations and migration status;
- formatting, lint, strict typecheck, unit/integration/RLS tests, production
  builds, dependency audit, and secret scan;
- real-device browser, tablet, printer, Cash, and UPI smoke tests;
- production backup and documented restore point;
- correct legal name, outlet details, GSTIN/tax profile, timezone, receipt
  sequence, and payment configuration;
- no unresolved P0/P1 security or financial-integrity issue.

If production SMS OTP is not configured, testing remains an internal staging
pilot only. Insecure development OTP must remain development-only and loopback-
restricted.

## 2. Production Authentication and Secret Rotation

Before production deployment:

1. Rotate every database password and `sb_secret_...` key ever exposed in chat.
2. Update deployment secrets directly; never paste replacement values into chat,
   source, screenshots, logs, or planning documents.
3. Revoke old keys and confirm they fail.
4. Configure Supabase Phone provider and the MSG91 Send SMS hook for production.
5. Test successful OTP, expired OTP, wrong OTP, throttling, suspended account,
   invitation binding, logout, and logout-all.
6. Keep development OTP disabled unless all development-only containment flags
   and loopback requirements are satisfied.
7. Provision Razorpay test/live key pairs and independent webhook secrets only
   if Stock ordering is enabled for the release.
8. Store event-signing secrets independently in Billing and Stock. Use rotation
   version/key IDs so old in-flight signatures have a bounded grace window.
9. Verify employee PIN hashes, generic failures, terminal-wide throttling,
   employee lockout, and audit redaction.

Production logs must not contain OTPs, PINs, authorization headers, cookies,
database URLs, Supabase secret keys, MSG91 credentials, Razorpay secrets,
signatures, payment payloads, or customer phone numbers in clear text.

## 3. Outlet, Menu, and Employee Onboarding

Central performs onboarding in this order:

1. Verify JKSH organization and TVANAMM brand records.
2. Create the outlet with ownership type, legal/display name, address, timezone,
   phone, optional GSTIN, receipt footer, and payment modes.
3. Assign the Franchise Owner and complete mobile OTP invitation acceptance.
4. Configure Billing/Stock feature flags for that outlet.
5. Publish Central menu, categories, approved GST/HSN profiles, recommended
   prices, and availability.
6. Let the owner set final GST-inclusive outlet prices and create permitted
   private items/combos. Unmapped recipes show `not_stock_tracked`.
7. Create employees from name and employee ID; set the four-digit PIN through
   the secure flow without logging/displaying it afterward.
8. Enrol exactly one active Billing terminal for MVP.
9. Configure and test 58 mm/80 mm receipt rendering on the actual printer.
10. Run a training bill/refund in non-production before repeating controlled
    production smoke checks.

The launch sheet records the real IDs for organization, brand, franchise,
outlet, terminal, owner membership, menu version, and enabled feature versions.
Names are never used as database relationships.

## 4. Billing-Day Opening and Closing Workflow

### Opening

1. Terminal loads current outlet, menu, branding, receipt, and availability
   versions.
2. Employee logs in using employee selection plus four-digit PIN.
3. Employee confirms displayed name and opens their shift.
4. First authorized employee opens the one shared outlet Cash session and enters
   opening Cash. Denomination detail is optional.
5. POS confirms printer state, connectivity, pending offline queue, and current
   business date.
6. A manager resolves stale prior-day shift/Cash sessions before new billing.

### During trade

- Server calculates authoritative prices, discounts, GST, Cash rounding, and UPI
  exact totals.
- Cash and UPI are the only customer payment modes.
- UPI is confirmed from the outlet's external scanner/bank device; no POS
  Razorpay integration is used.
- Every bill is idempotent and commits bill, lines, payment, receipt number,
  audit, and event in one transaction.
- Printing failure never reverses a completed bill; authorized users can reprint.
- Same-day refund supports full bill or selected quantities with mandatory
  internal reason. Original bill data never changes.
- Ingredient shortage warns but does not block Billing. An explicitly paused
  item is visible as `Out of stock` and cannot be added.

### Closing

1. Synchronize/recover all locally pending bills before replacing the terminal
   or declaring the day closed.
2. Close individual employee shifts.
3. Any authorized employee may close the shared Cash session.
4. Enter one total counted Cash amount; denomination detail remains optional.
5. System shows expected, counted, and variance. Non-zero variance requires a
   reason and actor attribution.
6. Franchise Owner reviews sales, Cash/UPI, discounts, refunds, unsynced bills,
   and Cash variance.
7. Reports use the outlet-local business date; refunds remain negative movements
   on their refund date.

## 5. Stock Opening and Inward Workflow

### Enabling Stock

- Central warehouse and franchise outlets require Stock tracking.
- A JKSH-owned retail outlet may keep Stock disabled.
- Enabling an existing outlet starts with a complete physical opening count.
- Opening balances are posted as an immutable opening document, never direct
  balance edits.

### JKSH-supplied inward

1. Owner orders JKSH-required materials for one outlet.
2. Order/payment/dispatch does not increase outlet stock.
3. Dispatch pre-fills items, batches, and quantities for receiving.
4. Store Employee records accepted, short, damaged, excess, and rejected
   quantities.
5. Accepted stock posts inward; damaged/rejected stock follows its disposition.
6. Owner sees and resolves discrepancies without editing the dispatch.

### Local inward

- Employee selects an approved local material and enters mandatory quantity.
- Purchase cost is captured when available; otherwise it becomes `cost_pending`.
- Physical quantity posts immediately and the owner dashboard highlights the
  entry.
- Owner confirms commercial details or posts a reversal/correction.
- JKSH-required products, cups, and printed packaging cannot use local inward.

### Recipe consumption

- Only published, standardized recipes deduct ingredients automatically.
- Items without recipes remain sellable and display `not_stock_tracked`.
- Sale events are asynchronous/idempotent; Stock delay never blocks checkout.
- Recorded prepared bases are consumed without deducting raw ingredients twice;
  otherwise direct recipe inputs are consumed.
- Negative availability records a warning/exception and does not reject a bill.

## 6. Failure Recovery and Rollback

### Application rollback

- Keep the last known-good deployment artifact and configuration manifest.
- Roll back application code/configuration, not committed financial data.
- Disable incomplete modules with server-side outlet feature flags.
- Database migrations are forward-only; repair with a new migration. Never run a
  destructive production reset/rollback.

### Billing failure

- Duplicate checkout returns the existing idempotent result.
- Receipt numbers are never reused. Reserved/failed numbers are retained with an
  explicit state where required.
- A completed bill survives printer failure.
- Pending offline bills remain on the terminal until acknowledged individually.
- Batch sync returns per-bill outcomes; one invalid bill does not replay or
  duplicate successful bills.
- Stock event failure remains in Billing outbox for retry/dead-letter review.

### Razorpay/Stock-order failure

- Browser success without verified server payment remains pending.
- Webhook without browser return is processed idempotently.
- Payment captured while internal confirmation times out is reconciled through
  Razorpay API/webhook before retrying; a second payment is not created.
- Invalid signature has no effect and creates a safe security audit.
- Dispatch is blocked until the internal captured amount/currency matches.
- Refund/credit-note status is reconciled asynchronously and remains visible.

### Database/integration failure

- Stop affected writes using feature flags while preserving Billing checkout
  when only Stock is unavailable.
- Monitor outbox/inbox lag and replay by immutable event ID.
- Restore to an isolated environment first, verify checksums/counts, then follow
  the approved recovery procedure.
- Record incident start/end, affected outlets/receipts/orders, recovery actor,
  reconciliation evidence, and corrective action.

## 7. Launch-Day Support Responsibility

Assign one named person to each role before production opening:

| Role | Responsibility |
| --- | --- |
| Launch commander | Final go/no-go, feature flags, incident priority, communications |
| Technical owner | Deployments, logs, queues, database health, rollback |
| Billing owner | Menu/prices, receipts, shifts, Cash/UPI, refunds |
| Stock owner | Opening count, inward, balances, discrepancies, recipes |
| Accountant | GST details, Billing Cash/UPI records, and Stock Razorpay/refunds if Stock ordering is enabled |
| Outlet lead | Device, printer, employees, real customer workflow |

Use one private incident channel and one timestamped launch log. The outlet lead
must have a phone escalation path that does not expose credentials. Every manual
financial/stock repair requires a documented reason and authorized actor.

### Launch-day checkpoints

- Before opening: credentials, health, menu, terminal, printer, opening Cash,
  Stock count, and test transaction checked.
- First five real bills: verify totals, receipt sequence, printing, reports, and
  event delivery individually.
- Midday: reconcile bill count, Cash/UPI, refunds, queue lag, Stock exceptions,
  and error rate.
- Closing: complete Cash/UPI, bill/refund, receipt, Stock inward/consumption, and
  pending-job reconciliation.
- After close: capture approval or rollback/repair actions before adding outlets.

## 8. Expansion from Pilot to All Franchises

Expansion is outlet-by-outlet, never a global flag flip.

An outlet is eligible only after:

- at least one complete pilot business day reconciles with no unexplained bill,
  receipt, Cash/UPI, refund, payment, or Stock discrepancy;
- no open P0/P1 incident and acceptable error/latency/queue metrics;
- onboarding data and GST receipt details are reviewed;
- owner and employees complete workflow training;
- actual device/browser/printer passes smoke tests;
- Stock opening count is complete when Stock is enabled;
- support owners and rollback authority are assigned.

Rollout batches:

1. JKSH-owned/reference outlet.
2. One cooperative franchise outlet.
3. A small batch of similar outlets.
4. Remaining outlets in bounded batches with a hold period between batches.

Each rollout uses an explicit target selector and records configuration/menu
versions. Failed outlets remain on their prior working version. Central can
pause one outlet without interrupting the others.

## Release Execution Sequence

### Planning-complete checkpoint

- Lock only the release-candidate scope, API/database ownership, launch
  gates, and rollback contract. Keep the broader product roadmap open to new
  confirmed requirements without destabilizing the release candidate.
- Map every plan requirement to an implementation stage/test.
- Identify incomplete code honestly; do not convert a plan item to `done` without
  proof.

### Implementation and rehearsal checkpoint

- Complete the approved release-candidate scope.
- Run clean migrations, all automated gates, both builds, security review, and
  secret rotation.
- Configure non-production MSG91/Razorpay and event contracts where applicable.
- Seed/rehearse real-shaped outlet data without production customer data.
- Test the actual terminal, browser, printer, Cash/UPI flow, Stock opening/inward,
  offline recovery, and rollback artifact.
- Deploy production while the outlet is closed; perform non-financial health and
  authorization checks.

### Controlled-launch checkpoint

- Run before-opening checklist and explicit go/no-go.
- Enable only verified outlet features.
- Closely observe the first five bills and every exceptional workflow.
- Reconcile midday and closing.
- Do not add another outlet until the launch commander signs the pilot result.
