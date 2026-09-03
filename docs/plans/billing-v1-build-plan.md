# Complete Billing V1 Build Plan

Status: Implementation plan for the coding agent.

This is the end-to-end Billing V1 delivery sequence. It includes the Stage 1
audit repairs and every confirmed Billing feature. Stock remains a separate
system; Billing only publishes versioned events and consumes availability/recipe
references through an explicit contract.

## Governing Documents

- `docs/plans/stage-1-audit-remediation.md` — mandatory foundation repairs.
- `docs/plans/billing-data-api-plan.md` — database/API boundaries.
- `docs/checklists/billing-system.md` — master acceptance checklist.
- `docs/architecture/*.md` — confirmed business workflows.

When documents appear inconsistent, use the newest confirmed decision in the
architecture documents, repair the inconsistency, and never silently invent a
financial or authorization rule.

## Global Engineering Rules

- Two Next.js apps: `admin-web` and `pos-web`, with shared packages.
- One Billing Supabase project per environment, shared by both apps.
- All privileged reads and mutations go through server APIs and least-privilege
  actor-context database transactions.
- Store money as PostgreSQL `numeric` and decimal strings at API boundaries.
- Completed financial records are append-only and immutable.
- Every mutation is validated, scoped, idempotent, transactional, audited, and
  emits its outbox event in the same transaction where applicable.
- One active terminal per outlet for MVP, but IDs and receipt allocation must be
  safe for future multi-terminal support.
- Business date is the outlet-local calendar date and ends at midnight.
- Never expose PINs, OTPs, terminal credentials, payment references, customer
  data, or privileged keys through logs or browser bundles.

## Phase 0: Secure and Accept Stage 1

Complete every item in `stage-1-audit-remediation.md`, including:

- credential rotation;
- terminal-wide PIN throttling and timing protection;
- development OTP containment;
- working Accountant route;
- complete franchise/invitation onboarding;
- actor-context-only DB access;
- origin checks and security headers;
- dependency upgrade/advisory resolution;
- Route Handler and browser tests;
- formatting and documentation alignment.

Gate: Stage 2 does not merge until all P0/P1 repairs pass and P2 items are either
complete or explicitly approved for deferral.

## Phase 1: Catalog and Outlet Menu Publication

### Database

Add committed forward-only migrations for:

- master categories and display ordering;
- master menu items;
- reusable add-on groups and add-ons;
- outlet-owned private categories/items/add-ons;
- field-level outlet overrides;
- immutable master and outlet menu versions;
- publication jobs, target results, failures, and provenance;
- price/tax history and manual availability pause;
- optional Stock recipe ID/version and offline sale allowance.

Constraints:

- GST-inclusive decimal prices only;
- no product variants in V1;
- add-on min/max/required rules validated in DB/API;
- outlet-owned items cannot leak to another outlet/franchise;
- live POS reads only a complete published outlet menu version;
- drafts cannot become visible without explicit publication.

### APIs

- Central CRUD for master categories/items/add-ons.
- Franchise Owner CRUD for selected-outlet private items and allowed overrides.
- Preview publication changes and affected outlets.
- Publish Central changes to all or selected outlets.
- Publish Franchise Owner changes only to the selected outlet.
- Retry failed publication targets idempotently.
- Copy an outlet item to a new Central master draft.
- Fetch compact POS menu snapshot/diff by version.

### Admin UI

- Master menu editor for Central.
- Outlet menu editor for Franchise Owner.
- Clear badges for inherited, overridden, private, draft, and published fields.
- Draft → Preview → Publish flow with explicit confirmation.
- Central force-overwrite selections shown field by field; preserve outlet
  overrides by default.
- Availability and `Out of stock` management.

### Tests

- cross-franchise denial;
- draft isolation;
- atomic menu publication;
- override preservation and explicit force overwrite;
- publication retry without duplicate versions;
- price/history immutability;
- an open cart never changes when a new menu is published.

## Phase 2: Store Workspace, Shifts, and Shared Cash Session

### Database

Add:

- employee shifts;
- shared outlet cash sessions;
- optional denomination counts;
- force-close metadata and linked adjustments;
- indexes for outlet/business-date/open-state queries.

Rules:

- individual PIN login is operator tracking, not attendance;
- employee explicitly starts/resumes a shift before billing;
- multiple employee shifts may be open, but one operator controls the terminal;
- only one open cash session per outlet;
- first authorized employee opens it and enters opening cash;
- any logged-in employee may close it with counted cash;
- non-zero variance requires a reason;
- closing employee is recorded permanently;
- closed shifts/cash sessions cannot be edited or reopened;
- owner may force-close a forgotten employee shift with a mandatory reason;
- shifts and cash sessions must close before billing resumes after midnight.

### APIs and UI

- start/resume/end employee shift;
- open/get/close cash session;
- lock terminal, switch operator, and logout as distinct actions;
- force-close forgotten shift for Franchise Owner;
- employee shift summary and outlet cash closing summary;
- midnight-block screen with explicit closure workflow.

### Tests

- concurrent open cash session prevention;
- multiple shifts with one active operator;
- operator switch does not mutate financial records;
- midnight boundary in `Asia/Kolkata`;
- variance reason enforcement;
- immutable closed-session behavior;
- owner cannot edit/reopen a closed cash session.

## Phase 3: POS Cart and Transactional Checkout

### POS UI

- touch/tablet-first category navigation and local search;
- visible disabled `Out of stock` items;
- add/remove items and change quantities;
- enforce required/optional add-on group min/max selections;
- optional product-line and bill notes;
- optional collapsed customer name/mobile fields, anonymous by default;
- item-level and whole-bill discount controls;
- fixed and percentage discounts;
- mandatory reason per discount application;
- calculation review before payment confirmation;
- Cash or UPI as one payment method per positive-total bill;
- no split payment, credit, dynamic QR, or payment-gateway claim;
- complimentary confirmation for a zero-total bill.

### Authoritative calculation

The shared calculator and server must:

- load authoritative price/menu snapshots;
- include paid add-ons;
- allocate bill discounts deterministically across lines/add-ons;
- prevent negative lines/totals and discounts above payable value;
- keep original unit price and each discount separate;
- round Cash final total to nearest whole rupee and store round adjustment;
- keep UPI exact to two decimals with zero round adjustment;
- create no payment row for complimentary bills;
- snapshot customer-visible receipt data and internal tax values;
- reject unavailable/invalid quantities and malformed notes.

### Transaction

`CreateBill` must atomically create:

- immutable bill header;
- immutable lines and add-ons;
- discounts and allocations;
- optional Cash/UPI payment;
- receipt-number allocation;
- audit record;
- `SaleCompleted` outbox event.

Use a caller-supplied idempotency key. A retry or double tap must return the
original result and never duplicate a receipt, payment, or Stock event.

### Tests

- golden money calculations;
- Cash rounding boundaries and exact UPI;
- complimentary bills;
- every discount combination and allocation;
- authoritative price enforcement;
- menu changed during an open cart;
- duplicate/concurrent checkout;
- maximum lines, quantities, notes, and monetary values;
- Central cannot create a bill;
- employee cannot bill another outlet.

## Phase 4: Offline-First Billing and Synchronization

### Local data

Implement the POS as an installable PWA with IndexedDB containing:

- application shell/cache version;
- registered terminal identity;
- last approved outlet/menu snapshot;
- current cart recovery state;
- preallocated receipt-number block;
- locally committed bills;
- idempotent command/outbox queue;
- synchronization state and safe error details.

### Offline authorization

- Online validation issues a signed offline authorization bundle for at most 24
  hours.
- After 24 hours disconnected, existing pending bills remain visible/printable,
  but the POS cannot create new bills.
- Refunds, menu administration, terminal administration, and financial
  adjustments remain online-only.
- Offline selling respects the last approved availability plus per-item recipe
  allowance from Stock.

### Receipt allocation and sync

- Allocate receipt blocks server-side per outlet/terminal/business date.
- Replacement terminals and same-day reuse cannot collide.
- Commit locally before printing.
- Sync commands in order with exponential backoff and idempotency.
- Distinguish pending, syncing, synced, and failed sync from financial status.
- Permanent validation conflicts require an explicit recovery UI; never silently
  discard or renumber a printed bill.

### Tests

- browser refresh/crash after local commit;
- repeated sync and out-of-order network responses;
- offline across midnight;
- authorization expiry;
- receipt block exhaustion;
- terminal replacement collision;
- stale menu and Stock allowance exhaustion;
- reconciliation after reconnect.

## Phase 5: Receipt Printing and Same-Day History

### Receipt

Use immutable structured receipt snapshots. Print:

- configured logo, outlet/brand name, address/contact, optional GSTIN;
- `YYYYMMDD-T01-000001` receipt number;
- store-local business date/time;
- products, add-ons, quantity, inclusive unit price, discounts, totals;
- Cash round-off when applicable;
- payment method, or complimentary classification;
- configured footer.

Do not print employee identity, discount/refund reasons, internal IDs, or
taxable-value/CGST/SGST breakup.

Support tested 58mm and 80mm layouts. A print failure never rolls back or repeats
checkout. Reprints use the original snapshot and are audited.

### History

- Store Employees see all current-business-date bills for their outlet.
- Search by receipt number with cursor pagination.
- Load compact rows first and details on demand.
- Locally pending offline bills remain visible with sync status.
- Employees cannot browse previous business dates.
- Unpaid carts are discarded without creating financial records.

### Tests

- printer layout golden tests;
- long names/add-ons/notes and large totals;
- logo fallback;
- offline printing;
- disconnect/failure and safe reprint;
- no internal fields on customer receipt;
- history scope/date enforcement.

## Phase 6: Full and Partial Refunds

### Rules

- Completed bills are never updated, voided, or deleted.
- Store Employee may refund only an outlet bill from the current business date.
- Franchise Owner may refund an owned-outlet bill during its active 60-day
  operational period.
- Central Admin has no refund authority.
- Refund may be full bill or selected item/add-on quantities.
- Refund is immediate and needs no approval.
- A non-empty reason is mandatory and internal.
- Payout may be Cash or UPI and may differ from original payment method.
- UPI refund reference is mandatory; UPI sale reference remains optional.
- Refunds are online-only.
- Cumulative quantity/value cannot exceed the original refundable snapshot.
- Prepared/refunded items are not returned automatically to Stock; publish them
  as `customer_cancelled` wastage.

### Transaction and reporting

Atomically create refund header, refund lines/allocations, audit, cash-session
impact for Cash payout, and `SaleRefunded` outbox event. Report the negative
financial movement on the refund date without rewriting original sale-day totals.

### Tests

- full and partial refunds;
- repeated partial quantities;
- concurrent over-refund prevention;
- same-day employee cutoff;
- 60-day owner cutoff and cross-franchise denial;
- different payout method;
- missing UPI reference;
- Cash drawer impact;
- event quantities and wastage classification.

## Phase 7: Dashboards, Accountant, Reports, and Retention

### Dashboard projections

Build event-maintained daily/outlet summaries for:

- gross sales;
- discounts;
- refunds;
- net sales;
- Cash total;
- UPI total;
- complimentary count/value;
- bill count.

Franchise Owner lands on a combined outlet dashboard and drills into outlet
cards. Central receives the same financial view across all outlets plus outlet,
terminal, sync, and background-job health. Accountant receives financial,
reconciliation, GST-internal, adjustment, and export views only.

### Accountant adjustments

- Append-only payment-classification correction.
- Append-only Cash-variance adjustment.
- Mandatory reason and audit.
- Never edit original bills, payments, refunds, items, quantities, or totals.

### Reports and export

- Today, Yesterday, Last 7 Days, Last 30 Days, and custom range.
- Monthly report for the previous calendar month.
- Outlet breakdown plus authorized combined summary.
- Asynchronous Excel generation with checksum and short-lived download.
- In-app notification when monthly report/export is ready.

### Retention

- Keep bills in the hot operational store for 60 days.
- Notify owner on day 53 and day 59 if export is outstanding.
- On day 60, JKSH generates/verifies the export if the owner did not.
- Remove from hot queries only after verified export/archive manifest.
- Keep immutable compliance archive for the applicable statutory retention
  period; archived bills remain readable for authorized compliance workflows but
  cannot be refunded.
- Legal hold prevents disposal.

### Tests

- summary reconciliation against source transactions;
- refund-date treatment;
- role/scope filters;
- adjustment immutability;
- monthly job idempotency;
- Excel totals/checksum;
- notification schedule;
- archive only after verified export;
- legal hold and read-only archive.

## Phase 8: Billing-to-Stock Boundary

Billing does not read or write Stock tables.

### Outgoing events

- `SaleCompleted` with immutable bill, line, add-on, recipe-version, quantity, and
  outlet identifiers.
- `SaleRefunded` with exact refunded quantities/value and
  `customer_cancelled` wastage semantics.

### Incoming contract

- published availability per outlet item/add-on;
- recipe reference/version;
- offline sale allowance;
- update timestamp/version.

Events are versioned, idempotent, retryable, observable, and dead-lettered after
bounded failures. Billing continues independently when Stock is temporarily
unavailable using the last approved cached contract.

## Phase 9: Hardening and Pilot

- Threat-model OTP, PIN, terminal theft, tenant isolation, offline tampering,
  refunds, discounts, and report downloads.
- Test RLS denial for every tenant table and role.
- Load-test menu fetch, checkout, receipt allocation, history, dashboard, and
  reconnect synchronization.
- Add structured metrics for latency, error rate, DB pool pressure, sync backlog,
  outbox age, report failures, and suspicious auth attempts.
- Configure backups and perform a restore drill.
- Verify secret rotation and incident procedure.
- Test supported tablet/browser/printer combinations at a real TVANAMM outlet.
- Pilot with test data, then controlled real transactions.
- Obtain explicit JKSH approval before calling the scope Billing V1 frozen.

## Required CI Gates

Every merge must run:

- formatting;
- ESLint including Next.js and security restrictions;
- TypeScript strict checks;
- unit tests;
- database migrations on clean Postgres;
- database integration and RLS denial tests;
- Route Handler contract tests;
- browser smoke tests for critical flows;
- both production builds;
- dependency audit at high severity;
- secret scan.

Financial phases additionally require deterministic calculator golden tests and
concurrency/idempotency tests.

## Billing V1 Release Definition

Billing V1 is ready only when:

- all confirmed actors and scopes work without privilege leakage;
- TVANAMM can onboard a real franchise, outlet, employee, and terminal;
- an employee can open shift/cash, bill online or offline, print/reprint, refund,
  close cash, and end shift using the confirmed rules;
- owner, Central, and Accountant dashboards/reports reconcile exactly;
- 60-day export/archive automation is operational;
- Stock events are durable without coupling the two databases;
- credential, security, backup, recovery, and pilot gates pass;
- the master Billing checklist contains no unexplained incomplete item.
