# JKSH Billing and Stock — Software Planning Index

## Purpose

This index defines what “planning complete” means for the complete JKSH operating
product and its first production release. The target is a stable functional
baseline that should not need feature redesign for at least six months. It
separates confirmed product/architecture decisions from implementation status
and from real-world configuration data still required from JKSH.

Planning completion never means code completion or production readiness. A
feature is implemented only after its migration, authorization, API, UI,
offline/failure behavior, observability, and required tests have evidence.

## Precedence When Documents Conflict

Use this order:

1. the latest explicit user-confirmed decision;
2. this planning index and the production launch runbook;
3. focused architecture documents;
4. complete Billing/Stock build plans;
5. older execution plans/checklists.

Do not silently choose an older checklist statement when a newer confirmed
architecture document changed it. Update the conflicting document or record a
blocking decision.

## Canonical Documents

### Platform and launch

- `docs/architecture/platform-decisions.md`
- `docs/architecture/ui-ux-design-system.md`
- `docs/architecture/bulk-import-and-data-quality.md`
- `docs/architecture/operational-notifications.md`
- `docs/architecture/outlet-expenses.md`
- `docs/architecture/scheduled-offers.md`
- `docs/architecture/stock-scanning-labels.md`
- `docs/architecture/cash-movements.md`
- `docs/architecture/supplier-invoices-payments.md`
- `docs/architecture/ask-jksh-ai.md`
- `docs/plans/production-launch-runbook.md`
- `docs/plans/six-month-stability-plan.md`
- `docs/plans/stage-1-remediation-status.md`

### Identity and tenancy

- `docs/architecture/advanced-login.md`
- `docs/architecture/billing-actors.md`
- `docs/architecture/outlet-onboarding.md`
- `docs/architecture/stage-1-implementation.md`
- `docs/architecture/workforce-attendance.md`

### Billing

- `docs/plans/billing-v1-build-plan.md`
- `docs/plans/billing-data-api-plan.md`
- `docs/architecture/menu-publishing.md`
- `docs/architecture/pos-workflow.md`
- `docs/architecture/billing-shifts.md`
- `docs/architecture/offline-billing.md`
- `docs/architecture/receipt-printing.md`
- `docs/architecture/billing-history-refunds.md`
- `docs/architecture/billing-reporting.md`
- `docs/architecture/billing-retention.md`
- `docs/architecture/billing-optimization.md`

### Stock, ordering, and recipes

- `docs/plans/stock-v1-build-plan.md`
- `docs/architecture/franchise-owner-stock-portal.md`
- `docs/architecture/billing-stock-recipe-contract.md`
- `docs/architecture/t-vanamm-recipe-standardization.md`

### Tracking checklist

- `docs/checklists/billing-system.md` is a requirement checklist, not reliable
  evidence of current code completion until each checkbox is reverified against
  the final branch.

## Confirmed Product Summary

### Organization and actors

- JKSH is the parent organization; TVANAMM and T Leaf are brands.
- TVANAMM launches first; the platform remains brand-neutral.
- Actors are Central Admin, Accountant, Franchise Owner, and Store Employee,
  plus Stock Warehouse Manager and Warehouse Staff.
- Franchise Owners can own multiple outlets and enter through one OTP login and
  outlet-card switcher.
- Each outlet has one primary brand. One Franchise Owner may own outlets across
  different JKSH brands through the same login/cards.
- Store Employees use one registered outlet terminal, employee selection, and a
  four-digit PIN. PIN login is operator attribution, not attendance.
- Only Central creates outlets and internal Accountant access.

### Billing

- Cash and external-scanner UPI are the only Store customer payment methods.
- Prices are GST-inclusive; Cash rounds to the nearest whole rupee and UPI
  remains exact to two decimals.
- Employees may discount up to the payable value with mandatory internal reason;
  they cannot manually alter unit prices.
- Bills are immutable; same-day full/partial refunds require reason and are
  instant through selected Cash/UPI payout recording.
- Customer name/mobile are optional and not collected by default.
- Customer loyalty, points, campaigns, and customer CRM are intentionally
  outside scope.
- Receipt shows configured brand/outlet/legal details and hides employee and
  internal reasons.
- One shared outlet Cash session supports multiple employee shifts.
- Employees may instantly record operational expenses with mandatory reason and
  optional receipt. Shared-drawer expenses reduce expected closing Cash;
  outlet-UPI, owner-paid, and employee-paid expenses do not. Owner review follows
  entry, and unusual/high-value records alert without blocking.
- POS supports multiple same-day unpaid held carts and automatically discards
  them at business-day end without creating financial records.
- Audited mid-day Cash top-up, Cash drop, and bank-deposit movements participate
  in closing reconciliation and are corrected only by reversal.
- Franchise Owners see combined outlet cards and selected-outlet drill-down;
  Central sees all, Accountant sees internal financial views.
- Operational history remains available for 60 days with owner Excel export and
  archive/retention jobs as defined in the retention plan.

### Menu, pricing, recipes, and availability

- Central provides master menu and recommended GST-inclusive price.
- Owner can set location-specific final prices and create private menu items and
  combos for selected owned outlets.
- Franchise-created enabled items are immediately available and visible to
  Central; they use Central-approved GST/HSN profiles.
- V1 has no variants. A different size is a separate menu item.
- Add-ons may be free, fixed-price, or included; combos consume component recipes
  and proportionally allocate value/tax.
- Central and Franchise Owners can publish scheduled item/combo offers within
  their scope. Offers are separate discount allocations; coupons and loyalty are
  excluded.
- Central alone publishes recipes. Recipes are optional; unmapped items remain
  sellable as `not_stock_tracked`.
- The SOP scaling calculator derives quantities from batch inputs, usable yield,
  and serving size—not selling price. Current tea standard is 80 ml.
- Ingredient shortage warns but does not block Billing. Explicit `Out of stock`
  does block add-to-cart.

### Stock and Franchise ordering

- Billing and Stock use physically separate databases and signed idempotent
  events; Billing checkout never waits for Stock.
- Franchise outlets and the central warehouse track Stock; a JKSH-owned retail
  outlet may keep it optional.
- JKSH-required cups/printed packaging and controlled materials are ordered from
  JKSH; local materials use mandatory-quantity inward.
- Employee local inward affects physical quantity and awaits owner review.
- Immutable ledger, FEFO tracked batches, weighted-average valuation, counts,
  wastage, production, returns, recalls, and reconciliation are required.
- Direct transfers are limited to JKSH-owned locations. Franchise Stock always
  follows order, payment, dispatch, and inward.
- Supplier returns support quarantine, replacement, credit note, and refund
  allocation. Stock scanning supports camera and USB/Bluetooth devices, and
  ordinary thermal printers produce internal batch/barcode labels.
- Supplier inward requires an invoice number and optional attachment. Central
  supplier obligations track unpaid, partial, paid, overdue, and disputed status
  without becoming a full accounting system.
- Suggestions use demand, current/pending/in-transit stock, lead time, expiry and
  safety days; there are no manual min/max levels and no automatic ordering.
- One outlet per Stock order; prepaid payment is required before dispatch;
  partial dispatch/backorder and receipt discrepancy are supported.
- Razorpay is only for Franchise Owner-to-JKSH Stock orders. Signed server
  verification/webhook reconciliation is authoritative.
- Generic raw materials can be organization-shared; branded powders, packaging,
  recipes, menus, and controlled goods remain brand-scoped.

### Ask JKSH AI

- Central Admin and Accountant receive the full role/page-aware assistant for
  questions, evidence, insights, drafts, and authorized confirmed changes.
  Franchise Owner receives read-only owned-outlet reports and navigation. Store
  and Warehouse employees receive no AI access.
- All reads and writes use server-authorized tools and existing domain APIs. The
  assistant never has raw database access.
- Mutations require deterministic preview and explicit confirmation; sensitive
  actions retain fresh-auth/approval rules. AI cannot invent payment success,
  edit immutable history/audit, expose secrets, or bypass tenant scope.
- AI failure never blocks normal Billing/Stock operation. Usage is budgeted,
  model-routed, auditable, evaluated, and provider-neutral.
- Gemini on Vertex AI is the confirmed initial provider. Only minimized/redacted
  data is permitted under no-training and strongest available controlled/zero
  retention settings; credentials remain server-only.
- User-visible AI conversation history is retained for 30 days; approved action
  and audit metadata follows longer domain policy.
- Stock-order delivery charges and free-delivery rules are centrally configured,
  shown before payment, and snapshotted on the paid order.

### Workforce and excluded commercial modules

- Employee attendance is separate from authentication, POS operator shifts, and
  shared Cash responsibility.
- The product records basic attendance and employee activity; payroll, salary,
  leave calculation, and statutory HR processing remain outside the platform.
- Attendance schedules and late flags are optional; no selfie, GPS, or biometric
  proof is required.
- Operational notifications remain in-app; SMS is reserved for authentication
  OTP.
- Swiggy, Zomato, direct customer ordering, and other online-order integrations
  are intentionally outside scope. Store Billing handles counter sales only.
- Franchise royalty, franchise-fee, and Billing-software subscription accounting
  are intentionally outside scope.

## Planning Coverage Matrix

| Domain | Workflow/roles | API/DB boundary | Offline/failure | Cost/performance | Tests/release | Planning |
| --- | --- | --- | --- | --- | --- | --- |
| Identity, OTP, PIN, sessions | Covered | Covered | Covered | Covered | Covered | Complete |
| Organization/franchise/outlet | Covered | Covered | Covered | Covered | Covered | Complete |
| Menu, price, tax, add-ons, combos | Covered | Covered | Covered | Covered | Covered | Complete |
| Shift and shared Cash | Covered | Covered | Covered | Covered | Covered | Complete |
| Checkout and Cash/UPI | Covered | Covered | Covered | Covered | Covered | Complete |
| Offline Billing | Covered | Covered | Covered | Covered | Covered | Complete |
| Receipt, history, refund | Covered | Covered | Covered | Covered | Covered | Complete |
| Reports, export, retention | Covered | Covered | Covered | Covered | Covered | Complete |
| Billing–Stock events | Covered | Covered | Covered | Covered | Covered | Complete |
| Stock master/ledger | Covered | Covered | Covered | Covered | Covered | Complete |
| Procurement/production/count/waste | Covered | Covered | Covered | Covered | Covered | Complete |
| Franchise Stock order/dispatch/inward | Covered | Covered | Covered | Covered | Covered | Complete |
| Razorpay procurement payment | Covered | Covered | Online-only/reconciled | Covered | Covered | Complete |
| Recipes/SOP/prepared bases | Covered | Covered | Covered | Covered | Covered | Complete |
| Returns/recalls | Covered | Covered | Online approvals | Covered | Covered | Complete |
| Suggestions/analytics/anomalies | Covered | Covered | Covered | Covered | Covered | Complete |
| Combined Owner portal | Covered | Covered | Partial cached read | Covered | Covered | Complete |
| Employee attendance/activity | Covered | Covered | Restricted offline | Covered | Covered | Complete |
| UI/UX design system | Covered | Covered | Covered | Covered | Covered | Complete |
| Bulk import and data quality | Covered | Covered | Not applicable | Covered | Covered | Complete |
| Operational notifications | Covered | Covered | Cached inbox | Covered | Covered | Complete |
| Outlet operational expenses | Covered | Covered | Controlled queue | Covered | Covered | Complete |
| Scheduled offers | Covered | Covered | Versioned cache | Covered | Covered | Complete |
| Cash top-up/drop/deposit | Covered | Covered | Controlled queue | Covered | Covered | Complete |
| Supplier invoices/payments | Covered | Covered | Online reconciliation | Covered | Covered | Complete |
| Held POS carts | Covered | Covered | Durable local | Covered | Covered | Complete |
| Supplier returns/credit notes | Covered | Covered | Online resolution | Covered | Covered | Complete |
| Stock scanning/labels | Covered | Covered | Cached aliases | Covered | Covered | Complete |
| Ask JKSH AI | Covered | Covered | Graceful unavailable | Covered | Covered | Complete |
| Deployment, rollback, support, rollout | Covered | Covered | Covered | Covered | Covered | Complete |

## Inputs Still Required — Not Planning Gaps

These are operational/configuration inputs that JKSH must supply before their
feature can be enabled:

- production Billing and Stock Supabase projects/pooled connection settings;
- rotated Supabase/database secrets;
- MSG91 production auth key, approved SMS template, and Send SMS hook setup;
- Razorpay account activation, test/live keys, webhook secret, settlement and
  refund configuration;
- production domains/DNS/deployment-provider settings;
- JKSH/TVANAMM legal name, address, GSTIN, receipt contact/footer, logo;
- Pilot outlet, owner mobile, employee names/IDs, terminal, Cash opening,
  printer model/paper width, and configured UPI scanner;
- final master menu, Central GST/HSN profiles, recommended/outlet prices, combos,
  and initial availability;
- measured SOP quantities for spoon/pinch/scoop/ranges, actual usable batch
  yields, and non-tea serving/glass volumes;
- ingredient catalog and JKSH/local/flexible supply classification;
- Stock opening physical count, batches/expiry, local costs when available, and
  central warehouse opening balance;
- delivery-charge/refund/cancellation commercial configuration for Stock orders;
- named launch commander, technical, Billing, Stock, Accountant, and outlet
  support owners.
- Google Cloud project/billing, Vertex AI location, least-privilege service
  identity, allowlisted Gemini models, quotas/budgets, and verified retention
  controls.

Missing credentials or business data must never be replaced with hard-coded
production defaults.

## Planning Completion Checklist

- [x] Actor and permission model defined.
- [x] Billing and Stock domain/database ownership defined.
- [x] Online/offline behavior defined.
- [x] Billing, Stock, recipe, payment, and event invariants defined.
- [x] Franchise Owner combined portal defined.
- [x] Razorpay Stock-order boundary defined.
- [x] Server cost/load rules defined.
- [x] Failure, idempotency, replay, and rollback defined.
- [x] Security, audit, monitoring, backup, and release gates defined.
- [x] Pilot and phased rollout runbook defined without a forced calendar date.
- [x] Employee attendance/activity boundary defined; payroll excluded.
- [x] Online ordering integrations explicitly excluded from this product scope.
- [x] Six-month functional-stability scope and change policy defined.
- [x] Responsive, accessible, uncluttered UI/UX system and screen contracts
      defined.
- [x] Safe Excel bulk import, preview, validation, correction, and audit defined.
- [x] In-app notification scope and SMS-only-for-OTP boundary defined.
- [x] Scheduled item/combo offers defined; coupons and loyalty excluded.
- [x] JKSH-only direct transfers and formal Franchise fulfilment boundary defined.
- [x] Expense payment sources, Cash impact, optional evidence, owner review, and
      non-blocking alerts defined.
- [x] Mid-day Cash top-up/drop/bank-deposit and reversal rules defined.
- [x] Supplier invoice requirement, optional attachment, payable states, and
      payment reconciliation defined.
- [x] Stock-order delivery charge and free-delivery rules defined.
- [x] Supplier return, replacement, credit-note, and payable impact defined.
- [x] Camera/hardware scanning and thermal internal-label printing defined.
- [x] Multiple same-day held carts and automatic day-end discard defined.
- [x] Primary-brand outlet, cross-brand owner, shared-generic/brand-specific Stock,
      and combined Central audit reporting defined.
- [x] Ask JKSH AI permissions, tools, confirmations, grounding, audit, cost,
      failure behavior, evaluations, and rollout defined.
- [x] AI role boundary defined: full Central/Accountant, read-only Franchise
      Owner, and no Store/Warehouse employee access.
- [x] Gemini/Vertex AI provider, IAM, function-calling, model-routing, and data-use
      boundary defined.
- [x] Ran the final cross-document contradiction audit on September 5, 2026;
      aligned recipe optionality/ownership, explicit availability pauses,
      offline cached-menu behavior, selected-outlet publishing, Billing UPI, and
      Stock Razorpay boundaries.
- [x] Re-ran consistency checks after AI, multi-brand, expense, offer, supplier,
      scanning, held-cart, and JKSH-transfer additions; aligned AI role access,
      in-app-only notifications, and JKSH-only direct transfers.
- [ ] Map the implementation agent's final commits/tests to every release gate.

This is a living plan. New confirmed decisions must update this index and every
affected focused document; they do not silently rewrite already-issued financial
or inventory records. The remaining checkbox is implementation verification and
cannot be marked complete merely by writing a plan.
