# Billing System Build Checklist

This checklist defines the first product to build from scratch. A checkbox is
complete only when implementation, automated tests, authorization, audit logging,
and documentation are complete.

## 0. Product Decisions

- [x] Confirm billing actors: Central Admin, Accountant, Franchise Owner, and
      Store Employee. See `docs/architecture/billing-actors.md`.
- [x] Confirm a Franchise Owner may access multiple outlets through one login and
      select an outlet workspace card after authentication.
- [x] Confirm only Central Admin creates outlets.
- [x] Confirm JKSH has a Central-owned operational outlet.
- [x] Confirm Accountant has financial access across every outlet.
- [x] Confirm GSTIN is optional during outlet creation.
- [x] Confirm one active Billing terminal per outlet for MVP, with replacement
      support and future multi-terminal-ready data design.
- [x] Confirm JKSH-owned outlets use the same Store Employee PIN and shift model.
- [x] Confirm Central controls outlet suspension, closure, and reactivation.
- [x] Confirm Franchise Owners manage employees for their own outlets.
- [x] Confirm Central master-menu edits require an explicit reviewed `Publish to
      outlets` action and are never pushed automatically.
- [x] Confirm Franchise Owner price/menu edits use Draft, Preview, and explicit
      Publish for the selected outlet and never alter an open cart.
- [x] Confirm each Store Employee is assigned to exactly one outlet and does not
      select or enter codes for other outlets.
- [x] Confirm Central Admin may view/manage outlets but cannot create bills.
- [x] Confirm Store Employees cannot manually change catalog prices while billing.
- [x] Confirm Store Employees may discount up to the remaining bill value.
- [x] Confirm item-level and whole-bill discounts using fixed amounts or
      percentages.
- [x] Confirm a 100% discounted sale is stored as a complimentary bill without a
      Cash/UPI payment.
- [x] Confirm completed-bill refund access: Store Employees may refund.
- [x] Confirm that a non-empty refund reason is mandatory.
- [x] Confirm Store Employee refund policy: immediate, no approval, and only for
      bills generated on the same store-local business date.
- [x] Confirm complete-bill and partial item/quantity refunds are permitted.
- [x] Confirm initial refund payout choices: Cash or UPI.
- [x] Confirm refund payout method may differ from the original sale payment
      method.
- [x] Confirm UPI sale reference optional and UPI refund reference mandatory.
- [x] Confirm Franchise Owner historical refunds are limited to 60-day active
      records.
- [x] Confirm Accountant adjustments are limited to payment classification and
      Cash variance without changing original bills/totals.
- [x] Confirm customer payment modes: Cash and UPI only.
- [x] Confirm standard prices are GST-inclusive and receipts do not show a GST
      breakdown.
- [x] Confirm refunds affect reports on the refund date and never rewrite the
      original sale-day totals.
- [x] Confirm Cash rounds to the nearest rupee and UPI retains the exact amount.
- [x] Confirm receipt number `YYYYMMDD-T01-000001`, resetting daily per terminal.
- [x] Confirm receipt header uses centrally configured outlet name, address, and
      available details; outlet name is not embedded in the receipt number.
- [x] Confirm outlet-local business day ends at midnight and open shifts/Cash
      sessions cannot continue into the next business date.
- [x] Confirm any logged-in Store Employee may close the shared Cash session;
      closed sessions are immutable and the Franchise Owner has view-only access.
- [x] Confirm active history retention: 60 days, followed by verified Excel and
      archive processing with notifications.
- [x] Confirm offline billing is required for the first release.
- [x] Confirm offline authorization expires after 24 hours without server
      validation.

## 1. Login and Session Redesign

Detailed design: `docs/architecture/advanced-login.md`.

### Identity model

- [x] Confirm mobile-number SMS OTP for Central Admin, Accountant, and Franchise
      Owner.
- [x] Confirm no additional MFA factor for MVP.
- [x] Confirm one phone identifies one account; one account may have multiple
      internal capabilities or multiple owned-outlet memberships.
- [ ] Use one Identity service for Store and Admin applications.
- [ ] Store roles and permissions in server-controlled records or claims.
- [ ] Never authorize from browser-provided role or mutable user metadata.
- [ ] Model users, memberships, roles, franchises, stores, and permissions.
- [ ] Support one user having more than one membership if required.
- [ ] Add active, suspended, invited, and locked account states.
- [ ] Add secure mobile-number change and account-recovery flows.
- [ ] Add login throttling and brute-force protection.
- [ ] Add session expiry, refresh, revocation, and device tracking.

### Two interfaces, one authentication system

- [ ] Create `/store/login` for cashiers and store operators.
- [ ] Create `/admin/login` for Central, franchise, and billing administrators.
- [ ] Use the same Identity API and session format behind both screens.
- [ ] After authentication, resolve memberships on the server.
- [ ] Route a single-membership user directly to the correct workspace.
- [ ] Show a workspace selector when a user has multiple valid memberships.
- [ ] Prevent Store-only users from entering Admin APIs and routes.
- [ ] Prevent Admin-only users from operating POS unless explicitly permitted.
- [ ] Create Store Employees from name and phone number and generate employee ID.
- [ ] Implement four-digit PIN-only daily login on registered outlet terminals.
- [ ] Enforce outlet-local PIN uniqueness, hashing, throttling, and lockout.

### Separate the three session concepts

- [ ] Authentication session: proves the account identity.
- [ ] Workstation session: selects store, terminal, and operating context.
- [ ] Shift session: records cashier clock-in, clock-out, and cash responsibility.
- [ ] Do not create attendance/login-log records on every auth refresh.
- [ ] Define explicit `Open shift`, `Close shift`, `Lock terminal`, and `Logout`
      actions.
- [ ] Locking a terminal must preserve the open shift but hide billing data.
- [ ] Logging out must revoke the application session and clear local data.
- [ ] Closing a shift must calculate and record shift totals independently of
      logout.
- [ ] Add audit events for login, failed login, workspace selection, terminal
      lock, shift open/close, logout, and session revocation.

### Recovery and account administration

- [x] Confirm Central Admin creates Franchise Owners; public self-registration is
      disabled.
- [x] Confirm Franchise Owner onboarding uses a one-time invitation.
- [x] Confirm Franchise Owner assigns the employee's initial four-digit PIN.
- [x] Confirm Franchise Owner registers a new outlet terminal before employee PIN
      login is enabled.
- [ ] Implement invitation acceptance without exposing privileged keys.
- [ ] Implement self-service password reset.
- [ ] Implement administrator-initiated password reset as an authorized command.
- [ ] Implement user disable/reactivate commands.
- [ ] Force active sessions to end when a user is disabled.
- [ ] Never email plaintext passwords.
- [ ] Add tests proving users cannot modify other users or cross franchises.

## 2. Repository and Engineering Foundation

- [ ] Initialize TypeScript workspace and package manager configuration.
- [ ] Create `billing-web`, `admin-web`, and `billing-api` applications.
- [ ] Create shared UI, contract, validation, authentication, and logging packages.
- [ ] Configure formatter and strict lint rules.
- [ ] Configure unit, integration, and browser tests.
- [ ] Add build, lint, test, migration, and dependency-audit CI checks.
- [ ] Validate environment variables at startup.
- [ ] Separate browser-safe configuration from server secrets.
- [ ] Add structured logging and request correlation IDs.
- [ ] Add error monitoring without storing passwords or sensitive payment data.
- [ ] Document local development and deployment.

## 3. Billing Data Model

- [ ] Create organizations/companies.
- [ ] Create franchises and stores.
- [ ] Create billing terminals.
- [ ] Create users, memberships, roles, and permissions.
- [ ] Create product catalog and billing-menu projections.
- [ ] Create price lists and price-history records.
- [ ] Create tax definitions.
- [ ] Create customers only if required; allow anonymous walk-in sales.
- [ ] Create immutable bills.
- [ ] Create bill line snapshots containing sold name, price, tax, and quantity.
- [ ] Create payment records separately from bills.
- [ ] Create refund records and refund lines.
- [ ] Create discount and override records.
- [ ] Create shifts and shift summaries.
- [ ] Create sequential receipt-number allocation.
- [ ] Create an append-only audit log.
- [ ] Create an outbox table for reliable integration events.
- [ ] Add foreign keys, uniqueness constraints, checks, and indexes.
- [ ] Add tenant/franchise isolation policies.
- [ ] Commit every schema change as a migration.

## 4. Authorization Matrix

- [ ] Define capabilities instead of scattering role-name checks.
- [ ] Define `billing.sale.create`.
- [ ] Define `billing.sale.read.own_store`.
- [ ] Define `billing.sale.read.all_stores`.
- [ ] Define `billing.discount.apply` and discount limit.
- [ ] Define `billing.price.override`.
- [ ] Define `billing.sale.void`.
- [ ] Define `billing.refund.full`.
- [ ] Define `billing.refund.partial`.
- [ ] Define `billing.refund.approve`.
- [ ] Define `billing.shift.open` and `billing.shift.close`.
- [ ] Define `billing.report.store` and `billing.report.global`.
- [ ] Enforce capabilities in the API and database.
- [ ] Treat frontend guards only as navigation and UX controls.
- [ ] Test every capability with allowed and denied users.

## 5. Catalog and Menu for Billing

- [x] Confirm product variants are not required for MVP.
- [x] Confirm products support configurable add-ons.
- [ ] List sellable items for the selected store.
- [ ] Support categories and display ordering.
- [ ] Support item name, SKU/code, image, price, tax, and availability.
- [ ] Support store-specific availability.
- [x] Confirm the same product may have a different selling price per outlet.
- [ ] Implement outlet-specific pricing.
- [ ] Implement Central master-menu defaults and outlet-level configuration.
- [ ] Treat standard menu prices as GST-inclusive.
- [ ] Allow Franchise Owners to create franchise-owned menu items.
- [ ] Keep franchise-created items isolated from other franchises.
- [x] Confirm franchise-created items apply only to the selected outlet.
- [x] Confirm Franchise Owners can override all Central item display, add-on,
      price, and availability fields for owned outlets.
- [x] Confirm Central can copy a franchise item into a reviewed master-menu draft.
- [x] Confirm unavailable products stay visible as disabled `Out of stock` items.
- [ ] Preserve price history.
- [ ] Ensure a completed bill keeps its original product snapshot.
- [ ] Add search and category filtering.
- [ ] Add pagination or virtualization for large menus.
- [ ] Define how Stock publishes availability without owning Billing tables.

## 6. POS Workspace

- [x] Confirm orders do not require Dine-in, Takeaway, or Delivery classification.
- [x] Confirm no kitchen order ticket or preparation token for MVP.
- [x] Confirm anonymous sales by default with optional, non-blocking customer
      details.
- [x] Confirm discounts include paid add-ons.
- [x] Confirm optional plain-text product and bill notes.
- [x] Confirm printed receipts only for MVP; no SMS/WhatsApp receipt delivery.
- [ ] Select and validate store and terminal context.
- [ ] Require an open shift before billing if the business adopts shifts.
- [ ] Load menu through the Billing API.
- [ ] Add, remove, and change cart quantities.
- [ ] Prevent invalid, unavailable, or zero-quantity lines.
- [ ] Support notes or modifiers if required.
- [ ] Implement reusable add-on groups with optional/required and min/max rules.
- [ ] Support free and paid GST-inclusive add-ons per outlet.
- [ ] Snapshot selected add-ons in bill and refund lines.
- [ ] Calculate subtotal, line discounts, bill discounts, tax, and rounding.
- [ ] Round final Cash bills to the nearest whole rupee and store the adjustment.
- [ ] Keep UPI bills at the exact two-decimal calculated total.
- [ ] Prevent discounts from producing negative line or bill totals.
- [ ] Preserve authoritative unit price separately from applied discount.
- [ ] Show all calculations before payment confirmation.
- [ ] Require a non-empty discount reason.
- [ ] Prevent double submission while checkout is processing.
- [ ] Preserve an interrupted cart safely where required.
- [ ] Add keyboard and touch-friendly interactions.
- [ ] Meet accessibility and mobile/tablet requirements.

## 7. Transactional Checkout

- [ ] Implement a `CreateBill` server command.
- [ ] Validate caller, membership, store, terminal, and open shift.
- [ ] Load authoritative products, prices, taxes, and discount permissions.
- [ ] Calculate totals on the server using decimal-safe arithmetic.
- [ ] Allocate the receipt number inside the transaction.
- [ ] Insert bill, lines, discounts, and payments in one transaction.
- [ ] Add a client-generated idempotency key.
- [ ] Return the existing result when an idempotency key is retried.
- [ ] Write the audit and outbox events in the same transaction.
- [ ] Roll back everything when any step fails.
- [ ] Return stable error codes for UI handling.
- [ ] Test concurrent checkouts and receipt-number allocation.

## 8. Payments

- [ ] Support Cash and UPI customer payments.
- [ ] Record UPI as manually confirmed through the outlet's external bank scanner;
      do not build QR generation or payment-provider integration for MVP.
- [ ] Record payment amount, mode, reference, state, and timestamp.
- [ ] Never store raw card credentials.
- [ ] Validate that successful payments equal the bill total.
- [ ] Define pending, completed, failed, reversed, and refunded states.
- [ ] Make payment webhooks signature-verified and replay-safe.
- [ ] Use unique provider transaction IDs.
- [ ] Reconcile provider payments with internal payments.
- [ ] Define behavior when payment succeeds but bill confirmation times out.

## 9. Receipt and Printing

- [x] Confirm both 58mm and 80mm thermal-printer support.
- [x] Confirm configured outlet logo appears with text fallback.
- [x] Confirm employee identity is hidden from the customer receipt.
- [x] Confirm discount/refund reasons remain internal only.
- [ ] Define a versioned receipt data contract.
- [ ] Build receipt rendering separately from checkout logic.
- [ ] Support thermal printer dimensions.
- [ ] Support browser/PDF printing where required.
- [ ] Add Bluetooth printer adapter only as an integration module.
- [ ] Display printer connection and failure state.
- [ ] Complete the bill even if printing fails.
- [ ] Allow authorized reprinting.
- [ ] Mark reprints visibly if required.
- [ ] Record receipt print/reprint audit events.
- [ ] Snapshot company name, address, GST, and legal text on the bill.

## 10. Billing History

- [x] Confirm Store Employees see all current-day bills for their outlet.
- [x] Confirm any Store Employee can reprint any current-day outlet bill.
- [x] Confirm previous-day history is not available to Store Employees.
- [ ] Filter by date, shift, cashier, terminal, payment mode, and status.
- [ ] Search by receipt number and customer/reference information.
- [ ] Use server-side pagination.
- [ ] Open complete bill and payment details.
- [ ] Reprint without modifying the original bill.
- [ ] Export only data the caller is permitted to access.
- [ ] Avoid downloading full billing tables into the browser.

## 11. Void, Cancellation, and Refunds

- [x] Confirm unpaid carts are discarded without persistence.
- [x] Confirm completed bills are never edited or voided; correction uses refunds.
- [ ] Never hard-delete a completed financial record.
- [ ] Do not implement a completed-bill `VoidBill` mutation.
- [ ] Implement transactional full refunds by Store Employees.
- [ ] Implement selected-item and partial-quantity refunds.
- [ ] Calculate refund amounts from original bill lines on the server.
- [ ] Prevent arbitrary refund amounts and cumulative over-refunds.
- [ ] Require a non-empty refund reason and allow optional notes.
- [ ] Enforce same-business-day eligibility using the store timezone.
- [ ] Process eligible Store Employee refunds without approval.
- [ ] Permit Franchise Owners to refund older bills only within their own outlet
      scope.
- [ ] Do not grant Central Admin an automatic historical-refund override.
- [ ] Reject reliance on browser time or rolling 24-hour calculations.
- [ ] Prevent refunding more than the remaining refundable amount.
- [ ] Record refund payments independently.
- [ ] Emit `SaleRefunded` events.
- [ ] Preserve original bill values and complete audit history.
- [ ] Test duplicate, concurrent, unauthorized, and over-refund attempts.

## 12. Shifts and Cash Control

- [x] Confirm shifts track Billing operators, not general employee attendance.
- [x] Confirm PIN resolution shows the employee's name before shift start.
- [x] Confirm explicit `Start Shift` instead of automatic shift creation.
- [x] Confirm one common Cash drawer per outlet.
- [x] Separate employee shifts from the shared outlet Cash session.
- [x] Confirm one required closing total with optional denomination details.
- [x] Confirm multiple employee shifts may remain open while each terminal has
      only one active operator.
- [x] Confirm multiple separate shifts per employee per day are permitted.
- [ ] Open employee shift with employee, terminal, and outlet context.
- [ ] Open one shared outlet Cash session with opening Cash.
- [ ] Prevent conflicting terminal shifts if required.
- [ ] Track expected totals by payment mode.
- [ ] Lock billing while a shift is being closed.
- [ ] Record one counted closing Cash total and optional denominations.
- [ ] Calculate shared-drawer expected Cash and variance.
- [ ] Require reason/approval for unacceptable variance.
- [ ] Generate an immutable shift-close summary.
- [ ] Support manager review and audit history.

## 13. Reporting

- [x] Confirm Franchise Owner combined dashboard plus outlet drill-down cards.
- [x] Confirm Today, Yesterday, 7 Days, 30 Days, and Custom Date filters.
- [x] Confirm automatic previous-month report generation.
- [x] Confirm Franchise Owner metrics: gross sales, discounts, refunds, net sales,
      Cash, UPI, and bill count.
- [x] Confirm Central metrics plus outlet state, terminal sync, and job health.
- [x] Confirm internal JKSH-only Accountant dashboard for reconciliation, GST,
      adjustments, and exports.
- [x] Confirm monthly report notification is in-app only.
- [ ] Daily sales summary.
- [ ] Shift/cashier summary.
- [ ] Payment-mode reconciliation.
- [ ] Product and category sales.
- [ ] Discounts and overrides.
- [ ] Voids and refunds.
- [ ] GST/tax summary.
- [ ] Franchise/store comparison for authorized administrators.
- [ ] Use server-side aggregate queries.
- [ ] Export CSV/PDF asynchronously for large reports.
- [ ] Protect scheduled reports with job authentication.
- [ ] Record report creation and delivery status.

## 14. Billing-to-Stock Contract

- [x] Confirm Stock manages raw materials rather than finished menu quantities.
- [x] Confirm menu items and paid add-ons have raw-material recipes/BOMs.
- [x] Confirm completed sales drive recipe-material consumption in Stock.
- [x] Confirm controlled offline sale allowances rather than unlimited stale
      availability.
- [x] Confirm refunded prepared items record `customer_cancelled` wastage and do
      not restore raw materials.
- [x] Confirm Central standard recipes with outlet-specific Franchise Owner
      customization.
- [x] Confirm recipe mapping is optional and untracked items remain sellable.
- [x] Confirm fixed recipe versions with no ingredient substitutions for MVP.
- [ ] Billing owns sales, bill lines, payments, and refunds.
- [ ] Stock owns inventory balances, reservations, movements, and reconciliation.
- [ ] Billing never updates Stock tables.
- [ ] Stock never updates Billing bills or payments.
- [ ] Publish `SaleCompleted` after the bill transaction commits.
- [ ] Publish `SaleVoided` and `SaleRefunded` when applicable.
- [ ] Include event ID, version, correlation ID, franchise, store, bill ID, and
      line/product quantities.
- [ ] Exclude unnecessary customer/payment-sensitive data from Stock events.
- [ ] Make Stock event consumption idempotent.
- [ ] Define retry and dead-letter handling.
- [ ] Define reconciliation when Stock is unavailable.
- [ ] Version contracts without breaking either system.

## 15. Reliability and Offline Behavior

- [ ] Use real request cancellation with `AbortController`.
- [ ] Retry only safe reads automatically.
- [ ] Retry mutations only with idempotency keys.
- [ ] Define loading, timeout, conflict, and unavailable UI states.
- [ ] Add health checks and operational dashboards.
- [ ] Add database backup and restore drills.
- [x] Include offline sale creation in the MVP.
- [ ] Implement PWA application-shell caching.
- [ ] Implement IndexedDB command outbox; do not use ordinary cache/localStorage
      as the bill source of truth.
- [ ] Implement short-lived offline authorization bundles for registered outlet
      terminals.
- [ ] Preallocate collision-free receipt-number blocks per terminal.
- [ ] Synchronize commands with idempotency and server recalculation.
- [ ] Restrict refunds and administrative mutations to online mode for MVP.
- [ ] Show connection, pending sync, failure, and recovery states.

## 16. Security and Privacy

- [ ] Keep all service credentials on the server.
- [ ] Validate and size-limit every request body.
- [ ] Add rate limits to login, reset, exports, and public endpoints.
- [ ] Use secure HTTP-only cookies or a reviewed token-storage strategy.
- [ ] Configure strict CORS and security headers.
- [ ] Protect against XSS, CSRF, injection, and insecure direct object access.
- [ ] Redact passwords, tokens, payment references, and personal data from logs.
- [ ] Encrypt transport and sensitive stored fields as required.
- [ ] Add dependency scanning and secret scanning.
- [ ] Perform an authorization review before pilot deployment.

## 17. Automated Test Gates

- [ ] Unit-test all money and tax calculations.
- [ ] Unit-test permissions and state transitions.
- [ ] Integration-test tenant/franchise isolation.
- [ ] Integration-test atomic rollback.
- [ ] Integration-test idempotency and concurrent checkout.
- [ ] Integration-test refund limits and approval.
- [ ] End-to-end test Store login, shift opening, sale, print, history, refund,
      shift close, and logout.
- [ ] End-to-end test Admin login and reporting.
- [ ] Test session expiry and disabled-account revocation.
- [ ] Test printer and network failure recovery.
- [ ] Require lint, type-check, tests, build, and migration validation in CI.

## 18. Pilot and Release

- [ ] Create legacy-to-new billing data mapping.
- [ ] Import products, stores, users, and opening configuration.
- [ ] Reconcile historical totals used for reporting.
- [ ] Prepare user training and operational runbooks.
- [ ] Pilot one store with named support owners.
- [ ] Run old and new totals in comparison mode where practical.
- [ ] Define go/no-go metrics.
- [ ] Test rollback before launch.
- [ ] Roll out store by store.
- [ ] Monitor errors, duplicate attempts, payment mismatches, and cash variance.
- [ ] Retire old billing only after signed reconciliation.

## MVP Completion Definition

Billing MVP is complete when an authorized cashier can securely log in, select a
store/terminal, open a shift, create and print an atomic bill, find and reprint
it, process an authorized refund, close the shift, and produce reconciled daily
totals—with cross-franchise isolation and automated tests proving the workflow.
