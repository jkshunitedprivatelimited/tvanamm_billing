# Billing Database and API Plan

This plan translates the confirmed workflows into implementation boundaries. It
is a specification for coding, not application code.

## 1. Supabase Topology

Use one Billing Supabase project per environment:

- `jksh-billing-dev`
- `jksh-billing-prod`

POS and Admin share the project. Separate responsibilities into schemas:

- `identity`: people, memberships, employees, terminals, sessions.
- `billing`: brands, outlets, catalog, bills, payments, refunds, shifts, reports.
- `audit`: immutable security and financial audit records.
- `outbox`: reliable Billing events and job commands.

Supabase `auth.users` is used only for Central Admin, Accountant, and Franchise
Owner mobile-OTP identities. Store Employees use outlet-scoped employee records,
hashed PINs, registered terminals, and short-lived operator sessions.

## 2. Database Access Model

- Browser apps use Supabase directly only for supported mobile OTP/session
  establishment.
- All identity, terminal, employee, menu, billing, refund, reporting, archival,
  and financial mutations go through TypeScript APIs.
- APIs use separate least-privilege database roles such as `identity_api` and
  `billing_api`; normal request handling does not use an unrestricted service-role
  client.
- Each transaction sets verified actor, organization, franchise, outlet,
  terminal, and session context.
- RLS and grants enforce scope in addition to API capability checks.
- Background jobs use narrowly scoped job roles.
- Supabase service role is reserved for exceptional managed-auth operations and
  never exposed to browser code.

## 3. Identity Schema

### `identity.account_profiles`

Links Supabase Auth users to the application.

Key fields: account ID, auth user ID, normalized mobile, display name, status,
created/updated timestamps.

Constraints:

- one Auth user per account;
- one normalized mobile per human account;
- status in `invited`, `active`, `suspended`, `locked`, `closed`.

### `identity.roles` and `identity.capabilities`

Initial roles:

- `central_admin`
- `accountant`
- `franchise_owner`

Role-capability mappings are data/migrations, not frontend constants used as the
security boundary.

### `identity.memberships`

Connects an account/role to organization, brand, franchise, and optional outlet
scope. One account can have Central plus Accountant capabilities or own multiple
outlets.

### `identity.store_employees`

Key fields: employee UUID, generated display employee ID, outlet ID, name,
normalized mobile, PIN hash/version, status, failed attempts, lock time, creator,
timestamps.

Constraints:

- exactly one outlet per employee;
- employee display ID unique;
- PIN unique within an outlet at assignment time;
- plaintext PIN is never stored.

### `identity.terminals`

Key fields: terminal ID/code, outlet ID, name, status, public credential ID,
credential hash/version, paper width, last validated/synchronized time, app
version, enrolled/revoked actor and timestamps.

MVP constraint: one active terminal per outlet. Terminal replacement revokes the
old credential in the same transaction.

### `identity.operator_sessions`

Short-lived Store Employee sessions bound to employee, terminal, outlet, shift,
issued/expiry time, offline bundle version, and revocation state.

### `identity.invitations`

Tracks Central-created Franchise Owner invitation lifecycle: pending, delivered,
accepted, expired, cancelled. Invitation is single-use and linked to the exact
mobile/memberships created by Central.

## 4. Organization and Outlet Model

### `billing.organizations`

JKSH is the initial parent organization.

### `billing.brands`

Initial records: TVANAMM and T Leaf. Billing is enabled for TVANAMM first.

### `billing.franchises`

Customer ownership grouping assigned to Franchise Owner memberships.

### `billing.outlets`

Key fields: organization, brand, optional franchise, ownership type
(`jksh_owned`/`franchise_owned`), name, address fields, phone, optional GSTIN,
timezone, status, receipt configuration, created/managed by Central.

Only Central Admin can create, suspend, close, or reactivate outlets.

## 5. Catalog Model

### Authoring records

- `billing.categories`
- `billing.catalog_items`
- `billing.addon_groups`
- `billing.addons`
- `billing.item_addon_groups`
- `billing.outlet_item_overrides`
- `billing.outlet_addon_overrides`

A catalog item records whether it originates from Central master or one selected
outlet. Field-level outlet overrides preserve customized name, image, category,
add-ons, GST-inclusive price, and availability.

### Publication records

- `billing.menu_publications`
- `billing.menu_publication_targets`
- `billing.outlet_menu_versions`
- `billing.outlet_menu_version_items`

Saving Central changes creates drafts. `Publish to outlets` previews targets and
applies a complete immutable menu version atomically per outlet. Force-overwriting
outlet fields is explicit and audited.

POS reads a compact published menu snapshot. It never composes a live menu from
many authoring tables during checkout.

### Stock recipe reference

Published menu lines may include optional Stock recipe ID/version and offline
sale allowance. Missing recipe means `not_stock_tracked`, not unsellable.

## 6. Shift and Cash Schema

### `billing.employee_shifts`

Tracks employee/operator start, end, outlet, terminal, status, and force-close
metadata. Multiple shifts per employee per business date are allowed; only one
open shift per employee at a time.

Business date is the outlet-local calendar date and changes at midnight. Open
shifts and Cash sessions cannot cross that boundary; the terminal requires them
to be closed before new-day billing begins.

### `billing.cash_sessions`

Tracks the one shared outlet Cash drawer: outlet, opening/closing actor and time,
opening Cash, expected Cash, counted Cash, optional denomination JSON, variance,
and mandatory variance reason when non-zero.

Any PIN-authenticated Store Employee may close it. Closed sessions are immutable:
the Franchise Owner may view them but cannot reopen or edit them. Corrections use
separate append-only Accountant adjustments.

Employee shifts and outlet Cash sessions are intentionally separate.

## 7. Immutable Billing Schema

### `billing.bills`

Key fields: bill ID, outlet/terminal/employee/shift/cash-session IDs, receipt
number, business date, menu version, customer optional fields, subtotal,
discount, pre-round total, round adjustment, final total, nullable payment method,
terminal occurrence time, server commit time, offline indicator, idempotency key.

Constraints:

- receipt number unique;
- idempotency key unique within command scope;
- final total non-negative;
- payment method is null only when final total is zero and bill classification is
  `complimentary`;
- UPI round adjustment equals zero;
- Cash final total is whole-rupee;
- update/delete denied after insert except controlled archival metadata.

### `billing.bill_lines`

Snapshots item ID, name, quantity, GST-inclusive unit price, base total, discount,
final total, optional note, and optional Stock recipe ID/version.

### `billing.bill_line_addons`

Snapshots add-on identity, name, quantity, unit price, discount allocation, total,
and optional Stock recipe ID/version.

### `billing.payments`

Immutable Cash/UPI payment record for positive-total bills. Complimentary bills
have no payment record. UPI sale reference is optional.

### `billing.discounts`

Stores bill-level or line-level scope, fixed/percentage input, allocated monetary
value, mandatory internal reason, employee, terminal, and timestamp. Bill-level
discounts are deterministically allocated across lines/add-ons for refunds and
reporting. Discount reasons do not appear on customer receipts.

## 8. Refund and Adjustment Schema

### `billing.refunds`

Immutable refund header: original bill, kind, payout method, mandatory reason,
mandatory UPI reference for UPI payout, employee/owner actor, outlet, amount,
business timestamp, and idempotency key.

Payout method is independently selected as Cash or UPI and is not constrained to
match the original sale payment method.

### `billing.refund_lines`

References original bill lines/add-ons and stores refunded quantity/value
allocations. Constraints and transaction locks prevent cumulative over-refund.

Store Employee authorization requires same outlet-local business date. Franchise
Owner authorization requires ownership and a bill still inside the 60-day active
period.

### `billing.accounting_adjustments`

Append-only payment-classification or Cash-variance adjustment, original record,
before/after classification/value, mandatory reason, Accountant actor, and time.
It cannot change original bill items or totals.

## 9. Audit, Outbox, Notifications, and Archive

### `audit.events`

Append-only actor/action/result/resource/outlet/session/terminal/correlation/time
records with redacted structured metadata.

### `outbox.events`

Transactional `SaleCompleted` and `SaleRefunded` delivery with version,
idempotency, attempt, next-attempt, delivered, and dead-letter state.

### `billing.notifications`

In-app monthly-report, export, archive, synchronization, and operational alerts.

### `billing.report_jobs` and `billing.export_jobs`

Asynchronous job state, parameters, data version, checksum, artifact reference,
requester, and expiry.

### `billing.archive_manifests`

Outlet/date range, row counts, totals, checksums, export confirmation, immutable
archive object reference, status, and audit metadata.

## 10. Identity API v1

### Admin/Owner authentication

- `POST /v1/auth/otp/request`
- `POST /v1/auth/otp/verify`
- `POST /v1/auth/logout`
- `POST /v1/auth/logout-all`
- `GET /v1/me`
- `GET /v1/me/workspaces`

### Invitations and accounts

- `POST /v1/invitations/franchise-owners`
- `POST /v1/invitations/{id}/resend`
- `POST /v1/invitations/{id}/cancel`
- `POST /v1/invitations/{token}/accept`
- `PATCH /v1/accounts/{id}/status`

### Employees

- `POST /v1/outlets/{outletId}/employees`
- `GET /v1/outlets/{outletId}/employees`
- `PATCH /v1/employees/{id}`
- `POST /v1/employees/{id}/reset-pin`
- `PATCH /v1/employees/{id}/status`

### Terminals and operator sessions

- `POST /v1/outlets/{outletId}/terminals/enroll`
- `POST /v1/terminals/{id}/replace`
- `POST /v1/terminals/{id}/revoke`
- `POST /v1/operator-sessions/pin-login`
- `POST /v1/operator-sessions/lock`
- `POST /v1/operator-sessions/logout`
- `POST /v1/operator-sessions/offline-bundle/refresh`

## 11. Billing API v1

### POS configuration and menu

- `GET /v1/pos/bootstrap`
- `GET /v1/pos/menu?version={version}`
- `POST /v1/pos/menu/sync`
- `POST /v1/pos/receipt-number-allocation`

### Shifts and Cash

- `POST /v1/shifts`
- `POST /v1/shifts/{id}/end`
- `POST /v1/shifts/{id}/force-close`
- `POST /v1/cash-sessions`
- `POST /v1/cash-sessions/{id}/close`

### Bills and refunds

- `POST /v1/bills`
- `GET /v1/bills?outletId=&businessDate=&cursor=`
- `GET /v1/bills/{id}`
- `POST /v1/bills/{id}/print-attempts`
- `POST /v1/bills/{id}/refunds`

There are no bill update, bill delete, or completed-bill void endpoints.

### Catalog and publication

- CRUD routes for master/outlet categories, items, add-ons, and overrides.
- `POST /v1/menu-publications/preview`
- `POST /v1/menu-publications`
- `GET /v1/menu-publications/{id}`
- `POST /v1/menu-publications/{id}/retry-failed`
- `POST /v1/outlet-items/{id}/copy-to-master`

### Dashboards, reports, archive

- `GET /v1/dashboards/franchise`
- `GET /v1/dashboards/central`
- `GET /v1/dashboards/accountant`
- `POST /v1/reports`
- `POST /v1/exports`
- `GET /v1/jobs/{id}`
- `GET /v1/notifications`
- `POST /v1/notifications/{id}/read`
- `GET /v1/archives`
- `POST /v1/accounting-adjustments`

## 12. Command Rules

Every mutation:

1. Validates a versioned request schema.
2. Authenticates the account or Store Employee operator session.
3. Resolves capabilities and scope server-side.
4. Uses one database transaction.
5. Locks affected financial/sequence rows when necessary.
6. Enforces idempotency.
7. Writes the domain record, audit record, and outbox event atomically.
8. Returns a stable success/error contract with correlation ID.

Money is represented as decimal strings at API boundaries and PostgreSQL numeric
values internally, never binary floating point.

## 13. Migration Order

1. Schemas, extensions, enums, and database roles.
2. Organization, brand, franchise, and outlet tables.
3. Identity accounts, memberships, employees, terminals, and invitations.
4. Authorization functions, grants, and RLS policies with denial tests.
5. Catalog authoring and immutable menu publication tables.
6. Shifts and Cash sessions.
7. Bills, lines, add-ons, payments, discounts, and receipt allocation.
8. Refunds and accounting adjustments.
9. Audit/outbox/notifications/jobs/archive manifests.
10. Indexes, immutable-record protections, reconciliation views, and test data.

No production schema change is applied manually outside committed migrations.

## 14. Acceptance Tests Before UI Integration

- Cross-franchise/outlet reads and writes are denied.
- Central can manage but cannot create bills.
- Accountant cannot mutate original financial records.
- Employee PIN works only on the registered assigned-outlet terminal.
- One active terminal per outlet is enforced.
- Online/offline duplicate bill commands create one bill.
- Receipt numbers remain unique across date/terminal allocations.
- Cash and UPI rounding constraints are enforced.
- Same-day Store Employee and 60-day Franchise Owner refund windows are enforced.
- Partial/full cumulative refund cannot exceed original quantities or value.
- UPI refund without reference is rejected.
- Bill records cannot be updated/deleted through application roles.
- Audit and outbox records roll back when the command fails.
- Dashboard/report queries return only authorized summaries.
