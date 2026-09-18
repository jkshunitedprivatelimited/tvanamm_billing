# Complete Stock V1 Build Plan

## Objective and Boundary

Stock V1 manages JKSH warehouse inventory, franchise outlet inventory,
procurement, production, franchise supply orders, prepaid Razorpay payment,
dispatch/inward, recipes, theoretical sale consumption, counts, wastage, returns,
recalls, recommendations, and oversight analytics.

Billing and Stock are separate systems:

- separate Supabase projects/databases per environment;
- existing Billing Identity is the only login/identity issuer;
- no cross-database joins, foreign keys, or distributed transactions;
- versioned signed events with transactional outbox/inbox, idempotency, replay,
  and reconciliation;
- Billing checkout never waits for Stock or Razorpay.

The combined Franchise Owner experience and Razorpay boundary are defined in
`docs/architecture/franchise-owner-stock-portal.md`. Recipe/SOP rules are in
`docs/architecture/t-vanamm-recipe-standardization.md`.

## Actors and Permissions

### Central Admin

- manages Stock configuration across JKSH, warehouses, franchises, and outlets;
- owns JKSH material/supply catalog, approved tax/commercial rules, recipes,
  recalls, and reporting policies;
- views purchases, production, dispatch, outlet inward/consumption/counts,
  anomalies, and audit;
- cannot rewrite posted stock or financial documents.

### Accountant

- verifies/reconciles prepaid Stock-order payments;
- manages GST invoice/credit-note views and financial reports;
- reads valuation and audit reports;
- cannot receive, pick, dispatch, count, waste, or directly adjust stock.

### Warehouse Manager

- operates only assigned warehouses;
- manages suppliers, purchase orders, production, receiving, allocation,
  dispatch, counts, wastage, transfers, recalls, and approved corrections;
- reviews Warehouse Staff exceptions.

### Warehouse Staff

- scans/receives, picks, packs, dispatches, counts, and records wastage in an
  assigned warehouse;
- cannot verify payments, alter commercial terms, approve their own exceptional
  adjustment, or delete movements.

### Franchise Owner

- views and manages inventory for owned outlets;
- creates and prepays one-outlet JKSH stock orders;
- reviews suggestions, employee local inward, discrepancies, counts, wastage,
  return-to-inventory requests, and returns;
- cannot see another franchise or edit Central recipes.

### Store Employee

- works only in the active terminal outlet;
- records delivery/local inward, physical counts, wastage/cancellation, and
  eligible return-to-inventory requests;
- cannot edit/delete a posted movement or approve their own exceptional request.

Authorization is enforced both in application capabilities and PostgreSQL RLS.

## Core Invariants

1. Every quantity change is an immutable movement linked to a source document
   and idempotency key.
2. Balances are transactionally updated projections; the ledger is authoritative
   and can rebuild them.
3. Quantities use fixed-point base units and money uses integer paise.
4. Tenant/scope integrity is enforced with composite constraints, triggers, and
   RLS—not browser-provided filtering.
5. Posted orders, receipts, dispatches, invoices, counts, adjustments, returns,
   recalls, and movements are corrected using new documents, never edited.
6. Outlet inventory is isolated. Direct transfers are allowed only between
   JKSH-owned locations; franchise outlets use formal order/dispatch/inward and
   cannot transfer directly between outlets.
7. Insufficient Stock warns and records an exception but never rejects an
   already-completed Billing sale.
8. Prepared products do not restore consumed ingredients after refund.
9. Only explicitly returnable unopened/resalable packaged products may return
   to inventory after owner approval.
10. Tracked branded batches use FEFO allocation; accounting valuation uses
    weighted-average cost.
11. Payment must be server-verified before franchise-order dispatch.
12. A receipt discrepancy never mutates its dispatch.
13. A recalled batch is unavailable for allocation and traceable across current
    and historical locations.

## Master Data

Stock records:

- units and versioned item-specific conversions;
- JKSH-required, local-purchase, and flexible item supply rules;
- raw materials, packaged products, packaging, and consumables;
- organization-shared generic materials and brand-scoped powders, packaging,
  recipes, finished goods, and other controlled products;
- warehouses and sellable/quarantine/damaged/returns locations;
- barcode/QR aliases and manual-entry reason;
- batch/lot, manufacture, expiry, status, genealogy, and recall flags;
- GST/HSN and supply/order-pack information where relevant;
- immutable versioned recipes and intermediate preparation recipes.

Official cups and printed packaging are `jksh_required`. Franchise local inward
cannot be used for them. Changing a flexible item to JKSH-required affects only
future procurement.

## Central Procurement and Production

### Supplier purchase order

```text
Draft -> Submitted -> Approved -> Ordered -> Partially Received
      -> Received -> Closed
```

- Central/Warehouse Manager maintains approved suppliers and raises orders.
- Supplier receiving snapshots invoice, quantities, batch/expiry, accepted,
  damaged, rejected, and landed-cost components.
- Supplier invoice number is mandatory to finalize inward; attachment is
  optional. A receipt without it remains draft/quarantined.
- Partial receipt remains open; duplicate receipt commands are idempotent.
- Accepted/damaged stock posts to the correct locations; rejected quantity does
  not enter sellable stock.
- Supplier invoices derive `unpaid`, `partially_paid`, `paid`, `overdue`, and
  `disputed` states from immutable payments/allocations. Central Admin and
  Accountant record payments; warehouse staff cannot mark invoices paid.

### Supplier returns

- Warehouse staff may initiate return of damaged, wrong, expired, rejected, or
  quality-failed received material.
- The return references supplier, PO, receipt, invoice, item, batch, quantity,
  reason, and optional evidence; eligible quantity moves to quarantine.
- Warehouse Manager or Central confirms dispatch back to the supplier.
- Resolution is replacement, credit note, refund/payment allocation, or supplier
  rejection. Each resolution is a linked immutable document.
- Quantity cannot be returned twice. Supplier-rejected goods re-enter usable
  Stock only after authorized inspection; otherwise they remain quarantined or
  become wastage.
- Invoice/payable state derives from credit/refund allocations and is never
  manually overwritten.

### Production

```text
Draft -> Materials Issued -> Produced -> Quality Accepted/Rejected -> Posted
```

- FEFO selects input lots unless an authorized scanner selects a valid lot.
- Production consumes input lots and creates output batch genealogy.
- Accepted and rejected output use distinct disposition locations.
- Yield and process loss are recorded; correction uses reversal/repost.

### Counts and wastage

- Monthly full counts are mandatory for enabled warehouses/outlets.
- Optional cycle counts target high-value/high-variance materials.
- Variance requires a reason and immutable adjustment movement.
- Nobody approves their own exceptional adjustment.
- Wastage records item, batch, quantity, reason, actor, time, and optional signed
  object-storage evidence.

### JKSH location transfers

- Direct transfers are permitted only between JKSH-owned warehouses, outlets,
  and internal locations.
- Transfer-out and transfer-in are separate immutable movements linked by one
  transfer document; dispatched quantity stays in transit until accepted.
- Partial receipt, damage, shortage, batch/expiry, and discrepancy resolution
  are explicit.
- Franchise-owned outlets never receive a direct internal transfer. They use the
  formal prepaid order, allocation, dispatch, invoice, and inward workflow.
- Dispatch/receipt retries cannot duplicate movements, and tenant boundaries are
  enforced by the database and service authorization.

## Franchise Commerce and Fulfilment

### Supply catalog and ordering

- Central publishes the JKSH supply catalog, GST-inclusive prices, tax snapshot,
  delivery rule, order pack, and availability.
- Central configures delivery charge rules by selected outlet/order, including
  free-delivery conditions. The calculated charge and rule version are shown and
  snapshotted before Razorpay Order creation.
- Each order belongs to one outlet; quantities from different outlets never
  share a cart/order.
- Owner may start manually or convert an explainable suggestion to draft.
- Order changes after submission create a new revision/audit; captured payment
  cannot be silently repriced.

### Razorpay and payment

```text
Draft -> Awaiting Payment -> Payment Pending -> Paid/Failed/Expired
```

- Server creates provider order from authoritative amount/currency.
- Browser callback is provisional; server signature plus webhook/API
  reconciliation is authoritative.
- Webhooks use raw-body signature verification, unique provider IDs,
  idempotency, replay defense, fast acknowledgement, and asynchronous work.
- Captured payment enables fulfilment; pending/failed payment blocks dispatch.
- Approved cancellation/refund tracks the original payment asynchronously.
- Razorpay is never used for Store POS customer UPI.

### Allocation and dispatch

```text
Paid -> Approved -> Allocated -> Packed -> Partially/Fully Dispatched
```

- Allocation considers usable stock and FEFO batches.
- Partial dispatch is allowed; remainder stays backordered.
- Pack/dispatch scanning validates item, batch, order, and quantity.
- Each dispatch snapshots GST invoice data and posts warehouse movement.
- Returns/replacements/credit notes are linked documents, not invoice edits.

### Outlet inward and discrepancies

```text
Dispatched -> Partially/Fully Received -> Closed
```

- Staff receives prefilled dispatch lines through scan or reasoned manual entry.
- Accepted, short, damaged, excess, and rejected quantities are separate.
- Only accepted/approved excess enters sellable outlet stock.
- Owner reviews discrepancies; resolution may create replacement, credit note,
  approved excess receipt, or return collection.

## Local Inward

- Quantity is mandatory for franchise outlets.
- Cost/supplier/invoice may be completed by the owner when unavailable to staff;
  until then valuation is visibly `cost_pending`.
- Employee entry affects physical quantity immediately and is highlighted.
- Owner confirms or posts reversal/correction; no posted row is edited.
- Central sees local inward, pending costs, frequency, and comparison to recipe
  consumption/counts for operational oversight.

## Recipes and Billing Events

Billing publishes reference, menu, `SaleCompleted`, and `SaleRefunded` events.
Stock publishes recipe/availability/allowance/processing-result events.

On `SaleCompleted` Stock:

1. inserts the event into a unique inbox;
2. resolves the immutable recipe version captured on each line/add-on;
3. consumes a recorded prepared base or the direct raw inputs, never both;
4. allocates eligible batches through FEFO;
5. posts consumption and balance projections atomically;
6. records negative-stock exceptions without rejecting Billing;
7. updates daily consumption/recommendation projections;
8. writes the processing result to its outbox.

An item without a recipe remains sellable and is `not_stock_tracked`. Linking a
recipe later affects future bills only.

On `SaleRefunded`, prepared ingredients remain consumed. A sealed returnable
packaged product can return only through a separate employee request and Owner
approval workflow.

## Returns and Recalls

### Return

```text
Requested -> Approved/Rejected -> Collected -> Inspected
          -> Credit Note/Replacement -> Closed
```

- Employee may request return-to-inventory only for eligible unopened packaged
  goods; owner cannot approve their own request where separation is required.
- Prepared beverages/food never return to sellable inventory.
- Warehouse inspection decides restock, quarantine, damaged, or destruction.

### Recall

```text
Draft -> Active -> Locations Identified -> Quarantined
      -> Collected/Destroyed -> Closed
```

- Activating a recall immediately blocks the batch from allocation.
- Stock finds every affected warehouse/outlet and creates notification/actions.
- Quantities move to quarantine/disposition through immutable documents.
- Central tracks acknowledgement and unresolved affected quantity.

## Recommendations and Analytics

Recommendations have no manually configured min/max and never auto-order. They
use trailing consumption/sales, usable stock, expiry risk, pending/in-transit
stock, backorders, observed lead time, safety days, order pack, and later
seasonality. Owner can edit, dismiss, or convert to draft.

Central analytics includes:

- purchase/production versus warehouse issue;
- outlet JKSH/local inward versus theoretical consumption and physical count;
- best/low-selling menu items and material usage;
- estimated outside/unrecorded purchasing;
- wastage, cancellation, refund, discount, and return rates;
- stockout, expiry, cover-days, backorder, fulfilment, and discrepancy trends;
- outlet/franchise benchmarking and valuation/margin;
- explainable review flags for unusual patterns, never automatic accusations or
  penalties.

Owner dashboards show the same concepts only for authorized outlets.

## Offline and Reliability

- Cache bounded assigned master data and open receiving/count/wastage drafts.
- Offline physical commands use device idempotency keys and a durable browser
  outbox; server synchronization is authoritative.
- Payment, order submission, payment verification, discrepancy approval,
  invoice/credit-note issue, recall activation, and exceptional adjustment
  approval are online-only.
- Signed versioned events, unique inbox/outbox keys, retry/backoff, dead-letter
  visibility, replay, and reconciliation handle cross-system failure.
- Poison events do not block an entire event batch.

## Cost and Performance Constraints

1. Use the shared Admin portal shell and one Stock database per environment.
2. Do not add Redis in V1; use PostgreSQL constraints, advisory locks,
   inbox/outbox, and durable job claims.
3. Use a small bounded Stock pool (default maximum five per runtime) and release
   connections before external HTTP/file work.
4. Batch events, ledger lines, balances, scans, and notifications; no N+1.
5. Dashboard/history reads use maintained projections and cursor pagination,
   never full-ledger summation or unbounded offset scans.
6. Cache immutable recipe/catalog versions and compact diffs.
7. Upload evidence/invoices directly to object storage through signed grants.
8. Run large exports and long-range analytics asynchronously from daily rollups.
9. Partition ledger/inbox/audit only when measured volume requires it.
10. Measure route query count/duration, rows, pool pressure, event lag, storage,
    provider errors, and monthly infrastructure budget.

Pilot targets:

- cached master snapshot p95 below 250 ms server time;
- barcode lookup p95 below 150 ms;
- transactional inward/dispatch below 500 ms excluding upload/provider time;
- projected dashboard summary below 700 ms;
- event batches of at least 100 with exactly-once effects;
- zero browser render-loop database calls and zero N+1 line queries.

## Delivery Stages

### S1 — Foundation

Separate database, migration tooling, roles/capabilities, tenant context/RLS,
audit, reference projections, inbox/outbox, event signing, and CI.

### S2 — Inventory Core

Units/conversions, items/barcodes, warehouses/locations, batches, immutable
ledger, balance projections, FEFO, weighted-average valuation, and concurrency.

### S3 — Warehouse Operations

Suppliers, purchase orders, receiving, supplier returns/credit notes,
production/genealogy, counts, wastage, JKSH-owned location transfers, camera and
hardware scanning, thermal labels, and reversals.

### S4 — Franchise Commerce

Supply catalog, outlet order, Razorpay payment, verification/reconciliation,
partial allocation/dispatch, GST invoice, inward discrepancies, backorder,
return, replacement, and credit note.

### S5 — Recipe/Billing Integration

SOP scaling, recipe publication, optional prepared batches, sale/refund
consumers, negative-stock exceptions, processing results, and reconciliation.

### S6 — Recall, Suggestions, and Analytics

Recall execution, recommendations, combined Owner dashboard, Central oversight,
daily rollups, valuation, and explainable anomaly flags.

### S7 — Offline, Hardening, and Pilot

Durable offline draft queues, authorization/RLS/contract/browser tests,
rate-limits, monitoring, backup/restore, performance tests, feature flags, and
controlled warehouse/outlet pilot.

Every stage requires format, lint, typecheck, clean migration, unit/integration/
authorization tests, production build, dependency/secret scan, and documented
evidence. Planning completion does not mean implementation completion.
