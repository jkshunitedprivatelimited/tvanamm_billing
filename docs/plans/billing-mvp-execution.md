# Billing MVP Execution Plan

## Delivery Rule

Build complete vertical workflows. Each stage includes database migrations, API,
UI, authorization, audit events, and automated tests before moving forward.

## Deployment and Data Topology

- `billing.jkshunited.com`: Store Billing PWA.
- `admin.jkshunited.com`: Central, Accountant, and Franchise Owner application.
- One shared Billing Supabase project per environment; frontends do not receive
  separate projects.
- Development: `jksh-billing-dev`.
- Production: `jksh-billing-prod`.
- Database schemas: `identity`, `billing`, `audit`, and `outbox`.
- Stock receives its own project when implementation begins and physical
  separation is required.
- Billing follows the shortest path from POS to Billing API to PostgreSQL;
  Identity is not a per-command network hop.

## Stage 1: Foundation and Identity

- Initialize TypeScript monorepo.
- Create Billing web, Admin web, and Billing API applications.
- Configure PostgreSQL migrations, validation, logging, tests, and CI.
- Implement organizations, franchises, outlets, users, memberships, terminals,
  employee IDs, hashed PINs, sessions, and audit events.
- Implement Admin login, outlet cards, terminal enrollment, four-digit employee
  login, throttling, lockout, logout, and session revocation.

Exit: Central Admin, Accountant, Franchise Owner, and Store Employee can enter
only their authorized workspace.

## Stage 2: Catalog and Outlet Menu

- Implement Central master menu.
- Implement GST-inclusive standard pricing.
- Allow Franchise Owners to create private menu items.
- Implement different prices and availability per outlet.
- Keep V1 items single-portion with no variant model.
- Support free/fixed/included add-ons and Central/Franchise combos composed from
  existing items.
- Keep recipes optional: Franchise-created items can be enabled immediately and
  unmapped items are visibly `not_stock_tracked`; allow one-to-one packaged
  resale mappings.
- Add a Stock-owned scaling preview from batch inputs, usable yield, and serving
  quantity; do not calculate ingredient consumption from selling price.
- Prevent Store Employees from overriding prices during billing.

Exit: each outlet receives the correct isolated, sellable menu.

## Stage 3: POS and Checkout

- Implement employee shift start with name confirmation and a separate shared
  outlet Cash session with opening Cash.
- Implement product search, categories, cart, quantities, and unlimited discount
  with mandatory reason.
- Implement Cash and externally verified UPI selection.
- Implement whole-rupee Cash rounding and exact two-decimal UPI totals.
- Implement transactional, server-calculated, idempotent bill creation.
- Allocate receipt numbers and write bill, lines, payment, audit, and outbox event
  in one database transaction.

Exit: an employee can create exactly one valid bill despite network retries.

### Offline capability within Stage 3

- Add PWA shell and IndexedDB transactional outbox.
- Cache versioned outlet/menu/price configuration.
- Preallocate receipt-number blocks to registered terminals.
- Use confirmed daily terminal receipt numbers: `YYYYMMDD-T01-000001`.
- Limit offline authorization to 24 hours after online validation.
- Create and print Cash/UPI bills offline.
- Synchronize idempotently and expose recovery state.
- Keep refunds and administrative changes online-only for MVP.

## Stage 4: Receipt and History

- Implement thermal/Bluetooth and browser printing adapters.
- Show GST-inclusive prices without GST breakdown on the customer receipt.
- Implement print failure recovery and audited reprints.
- Implement paginated billing history and bill search.
- Move records out of active POS history after 60 days only after a verified
  owner-requested or JKSH-generated Excel export, with day 53, 59, and 60
  notifications.

Exit: completed bills remain accessible and printable without mutation.

## Stage 5: Refunds and Shift Closing

- Implement same-day Store Employee full and partial item/quantity refunds.
- Require a refund reason and calculate values on the server.
- Implement older refunds by Franchise Owners for owned outlets.
- Support Cash or UPI refund payout choice.
- Prevent duplicate and cumulative over-refunds.
- Publish exact `SaleRefunded` line quantities.
- Implement shared outlet closing Cash, optional denomination details, expected
  Cash, variance, mandatory variance reason, and multiple employee shifts per
  day.

Exit: refunds and shifts reconcile without deleting or rewriting original bills.

## Stage 6: Reports and Accounting

- Implement daily outlet, employee shift, Cash/UPI, discount, cancellation,
  refund, and GST reports.
- Implement Accountant read/export access plus immutable adjustment records.
- Implement franchise and JKSH aggregate reports with tenant isolation.

Exit: operational and accounting totals reconcile with bills and payments.

## Stage 7: Hardening and Pilot

- Complete unit, integration, authorization, concurrency, and browser tests.
- Add backup/restore, monitoring, rate limits, security headers, and secret scans.
- Import required legacy reference data.
- Pilot one outlet, reconcile totals, test rollback, and roll out gradually.

Exit: the pilot meets financial, security, reliability, and usability acceptance
criteria.

## Parallel Stock Start Point

Stock work starts after Stage 3 freezes version 1 of these contracts:

- product identity;
- outlet identity;
- `SaleCompleted`;
- `SaleRefunded`;
- event envelope and idempotency rules.
- versioned menu-item/add-on recipe references;
- bounded offline sale allowances and availability updates.

Stock remains a separate system and consumes events without accessing Billing
tables.
