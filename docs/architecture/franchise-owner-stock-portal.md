# Franchise Owner Billing, Stock, and Ordering Portal

## Product Boundary

The Franchise Owner uses one authenticated Admin portal and one outlet switcher.
Billing and Stock remain separate domains and separate databases behind that
experience. The browser never joins the databases or receives database keys.

- Billing owns menus, GST-inclusive selling prices, bills, payments, refunds,
  shifts, and financial reports.
- Stock owns inventory, recipes, inward, wastage, counts, JKSH supply orders,
  dispatches, invoices, recommendations, and Razorpay procurement payments.
- Existing Billing Identity remains the identity issuer. Stock resolves the
  signed identity to its own local access projection; it does not create a
  second Franchise Owner login.
- Data crosses the boundary only through versioned, signed, idempotent events.

For lower hosting cost, `admin.jkshunited.com` provides the shared navigation and
route shell. Billing and Stock server modules keep separate connection pools and
repositories even when deployed together initially. A measured load or security
need may split Stock into another deployment later without changing contracts.

## Owner Navigation

The owner lands on a portfolio view containing only authorized outlet cards.
Each card shows a compact summary and links to an isolated outlet workspace.

Outlet navigation:

1. Overview
2. Billing
3. Inventory
4. Order Stock
5. Suggestions
6. Inward and discrepancies
7. Counts and wastage
8. Returns
9. Reports
10. Menu and prices
11. Notifications

The persistent outlet switcher can return to the portfolio or another authorized
outlet. Every API resolves outlet access server-side; changing a URL must never
expose another franchise.

## Overview

The combined overview reads prepared projections rather than joining live
Billing and Stock transactions. It includes:

- gross/net sales, discounts, refunds, Cash, UPI, and bill count;
- current stock value, negative balances, and expiry/recall warnings;
- pending employee-created local inward reviews;
- suggested JKSH orders and dismissed suggestions;
- orders awaiting payment, allocation, dispatch, or inward;
- short, damaged, excess, and rejected receipt discrepancies;
- pending returns, replacements, credit notes, and notifications.

Billing and Stock cards load independently. If Stock is unavailable, Billing
remains usable and the Stock card shows delayed/unavailable state.

## JKSH Stock Order Flow

Each order belongs to exactly one outlet and uses only the sellable JKSH supply
catalog available to that outlet.

```text
Draft -> Awaiting Payment -> Paid -> Approved -> Allocated -> Packed
      -> Partially/Fully Dispatched -> Partially/Fully Received -> Closed
```

Rejected, cancelled, expired-payment, backordered, returned, replaced, and
credited states are retained as immutable history.

1. Owner opens `Order Stock` for an outlet.
2. The UI shows catalog price, GST, usable stock, pending quantities, and an
   explainable suggested quantity.
3. Owner edits quantities and builds an outlet-specific cart.
4. Server snapshots item, price, HSN/GST, tax, delivery charge, and final payable
   amount into a draft order.
5. Confirming payment creates a Razorpay Order on the server.
6. The owner completes Razorpay Checkout.
7. Browser callback is treated only as a provisional signal.
8. Server verifies the callback signature and reconciles Razorpay's signed
   webhook/API state.
9. Only a verified captured payment marks the Stock order `paid`.
10. Dispatch is database-blocked until payment is verified.
11. Warehouse may partially allocate/dispatch; remainder stays backordered.
12. Outlet staff records accepted, short, damaged, excess, and rejected
    quantities. Only accepted/approved quantities increase sellable inventory.

Orders and issued GST invoices are immutable. Corrections use cancellation,
credit-note, replacement, return, or adjustment documents.

## Razorpay Boundary

Razorpay is used for Franchise Owner payments to JKSH for Stock orders. It is not
used for Store POS customer UPI payments; POS continues using the outlet's
external bank scanner.

Required implementation rules:

- create Razorpay Orders only on the server from the authoritative amount;
- store provider order/payment IDs under unique constraints;
- verify checkout signatures in constant time;
- verify webhook signatures against the raw request body;
- make webhook processing idempotent and replay-safe;
- acknowledge webhooks quickly and perform downstream work asynchronously;
- query Razorpay for reconciliation when callback/webhook delivery is uncertain;
- never mark paid from browser-provided amount/status;
- never log secrets, signatures, full payment payloads, or sensitive payer data;
- use separate test/live keys and webhook secrets;
- permit dispatch only for the internally recorded captured amount and currency;
- record refunds against the original payment and reconcile asynchronous status;
- expose pending/failed/refund states without creating duplicate payments.

Default commercial rules:

- prices shown to owners are GST-inclusive with taxable/GST breakup;
- cancellation is allowed before allocation, subject to JKSH policy;
- an approved prepaid cancellation refunds the original payment method;
- delivery charge and tax treatment are centrally configured and snapshotted;
- delivery may use a Central flat/per-outlet/order rule or an explicit
  free-delivery condition; the owner sees it before payment and a paid order is
  never repriced;
- payment-provider fees are internal JKSH accounting and never mixed into Store
  POS customer billing.

## Reorder Suggestions

V1 does not store manual min/max levels and never places an order automatically.
An explainable suggestion uses:

- trailing recipe consumption and sales;
- current usable quantity and negative-stock exceptions;
- stock approaching expiry;
- pending orders, backorders, and in-transit dispatches;
- observed lead time and centrally configured safety days;
- seasonality only after sufficient history exists.

```text
suggested quantity =
  forecast demand through lead time and safety days
  - usable stock
  - confirmed inbound
  + backorder/shortage adjustment
```

The result is rounded to the item's order pack. The owner sees the reason and
inputs, then may edit, dismiss, or convert it into a draft order. A dismissal is
scoped and time-limited; it does not permanently disable future suggestions.

## Inventory and Inward

- JKSH order/payment/dispatch does not increase outlet inventory.
- Staff confirms actual receipt; accepted quantity posts inward.
- Local inward quantity is mandatory. Cost may be pending for owner review.
- Employee-created local inward affects physical quantity immediately and is
  highlighted on the owner's dashboard.
- Owner approval fills missing commercial detail or posts a reversal/correction;
  it never edits a posted ledger movement.
- JKSH-required cups and printed packaging cannot use local inward.
- Franchise outlets require Stock tracking. A JKSH-owned retail outlet may keep
  it disabled; the central warehouse always requires it.

## Offline Behavior

- Owners may browse a recently cached read-only inventory/order snapshot.
- Creating payment, approving discrepancies, submitting an order, activating a
  return, or changing commercial terms requires an online connection.
- Outlet staff may queue bounded inward/count/wastage drafts offline with device
  idempotency keys; server acceptance is authoritative after synchronization.
- Razorpay Checkout is never represented as available offline.

## Performance and Cost

- Keep Billing checkout independent of Stock/Razorpay latency.
- Read the combined dashboard from daily/current projections and load drill-down
  only when opened.
- Use cursor pagination for orders, ledger, inward, and notifications.
- Batch Stock/Billing events and recommendation recalculation.
- Cache versioned supply catalog and immutable document snapshots.
- Keep separate small bounded Billing and Stock database pools.
- Use object storage signed uploads for payment evidence/invoices; never proxy
  large files through the application server.
- Do not add Redis in V1; use PostgreSQL idempotency keys, locks, inbox/outbox,
  and durable job claims.

## Required Tests

- owner cannot read/order for an unauthorized outlet;
- one order cannot mix outlets;
- client price/amount tampering is rejected;
- duplicate submit/callback/webhook creates one order and payment;
- invalid Razorpay signatures have no financial effect;
- payment pending/failed cannot dispatch;
- captured payment with internal timeout reconciles safely;
- partial dispatch/backorder and partial inward reconcile exactly;
- accepted/short/damaged/excess/rejected quantities do not mutate dispatch;
- suggestion accounts for usable, pending, and in-transit stock without
  auto-ordering;
- Stock failure never blocks Store customer billing;
- Accountant/warehouse/employee permissions remain distinct;
- refunds, credit notes, returns, and payment reconciliation are auditable.
