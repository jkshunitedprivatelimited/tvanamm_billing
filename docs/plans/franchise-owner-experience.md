# Franchise owner experience: implementation and release plan

## Objective and priority

Make the franchise owner workspace easy to operate across several outlets, with
reliable billing, understandable reporting and a complete stock replenishment
journey. Finish and validate this workspace before redesigning central admin.
Central admin's low-stock inbox is part of the owner replenishment workflow.

## Current implementation status

Delivered in this pass:

- Reports grouped into Sales overview, Menu performance, Team performance,
  Discounts & refunds, Cash reconciliation, and Exports & records.
- One outlet selector retained when changing report categories or dates.
- Billing CSV download respects the selected outlet and report dates.
- Detail queries run only for the active report category; loading feedback added.
- Audit renamed Activity history, with a purpose explanation, outlet/date/category
  filters, expandable event details, retry and cancellation of superseded requests.
- Outlet details grouped into Bills & refunds, Expenses, Attendance and Team & devices; only the active section loads.
- Stock checkout has search, base units, pack information, quantity validation and locks the draft before payment.
- Outlet cards expose Billing & team, Reports, Stock and Order stock directly.
- Stock overview and ordering identify the outlet; delivery wording simplified.

Existing functionality retained: owner stock checkout and prepaid payment,
receiving, discrepancies, returns, stock counts, wastage, bill review and expenses.
These existing workflows still require end-to-end owner acceptance testing.
Configurable per-item alerts are implemented, migrations applied, and the local worker is running; see stock-alert-rollout.md for hosted deployment requirements. 3 kg is only an example, never a default.

## 1. Owner home and consistent outlet context

Owner home should answer: How are my outlets doing? What needs my attention?
What should I do next?

- Portfolio summary: today's sales, bills, cash differences, stock alerts and
  orders awaiting receipt, each with a defined time range and drill-down.
- Outlet cards: name, city, operational status, last data update and shortcuts.
- Keep selected outlet in report and stock links. Label combined views explicitly.
- Separate genuine zero values, no results, missing setup and failed data loads.
- Treat offline or delayed stock consumption as stale data, with its timestamp.
- Keep central-only setup and internal integration tools out of owner navigation.

Acceptance: an owner with two outlets can find either outlet's sales and order
stock without encountering another franchise's records, including via direct URLs.

## 2. Reports and billing controls

| Category | Owner question | Contents |
| --- | --- | --- |
| Sales overview | How did my outlets perform? | Net/gross sales, bills, cash/UPI, outlet comparison |
| Menu performance | What sells? | Quantity and revenue by item; later category comparisons |
| Team performance | Who handled sales? | Employee sales, refunds and operational context |
| Discounts & refunds | Why was revenue reduced? | Reasons, amounts and links to supporting bills |
| Cash reconciliation | Does counted cash match? | Expected/counted cash, differences, closing history |
| Exports & records | Can I retrieve the evidence? | Scoped bill exports, clearly separate archive coverage |

Next improvements: bill-detail links from report rows, outlet-specific expenses
and net operating result with an explicit definition, search, bounded pagination,
consistent currency/quantity formatting and clear custom-date validation.
Cash/UPI payment figures must not be presented as profit. Retention coverage is a
workspace-level status and must not imply that it is outlet-filtered.

Billing acceptance: refund permissions and duplicate prevention, expense review,
opening/closing cash, receipt reprint and offline synchronization are tested using
an owner and outlet operator. Preserve authoritative money calculations.

## 3. Stock ordering and receiving

Journey: choose outlet → browse supplies → enter quantities with units → review
price/tax/delivery/total → pay → track order → receive actual quantities → resolve
differences or return damaged stock.

- Clearly label kg/g/litre/piece and pack sizes; never show a bare quantity.
- Prevent repeated submission while saving; retain draft quantities after errors.
- Show server-confirmed totals before payment and verified payment state after it.
- Provide owner order history with pending payment, paid, dispatched, partly
  received, received and cancelled states derived from actual backend states.
- Show expected versus received quantities and provide partial-receipt actions.
- Link reorder suggestions to a prefilled cart for the correct outlet and item.
- Make recalls and unavailable stock visibly ineligible for normal receiving/use.

Acceptance: repeat checkout callbacks and receipt submissions cannot duplicate
charges, orders or stock movements. A failed payment can be retried safely.

## 4. Low-stock alert: tea material at 3 kg

Thresholds are configurable per outlet and stock item. The requested example is
an explicitly selected tea material with a threshold of 3 kg; do not assume every
material uses kilograms or infer material identity from its display name.

### Detection

- Store threshold in the item's base unit: 3 kg = 3,000 g for a gram-based item.
- Use the authoritative usable stock balance, aggregated across eligible batches;
  exclude expired, quarantined and recalled quantities according to stock rules.
- Evaluate after committed consumption, receipt, wastage, count adjustment,
  transfer and return movements. Include an initial scan when enabling a rule.
- Open an alert at quantity <= threshold, including exactly 3 kg and negative
  stock. Keep one active episode for each outlet/item/rule.
- Resolve after usable quantity rises above the threshold. A later downward
  crossing starts a new episode. Repeated sales must not flood the inbox.
- Show stale consumption separately; never present delayed stock as current.

### Delivery

Stock and Billing/Identity use separate databases. Do not insert directly into
Identity notifications from a stock movement transaction.

1. In the Stock transaction, update alert state and append an outbox event.
2. A scheduled worker delivers committed events to Identity with a stable event ID.
3. Identity writes the notification and delivery receipt idempotently in one
   transaction. Mark Stock delivery complete only after success.
4. Retry transient failures with bounded backoff; surface dead-letter failures to
   central admin. Periodic reconciliation detects missed state transitions.
5. Notify central admin and the owning franchise, with outlet, material, usable
   quantity, threshold, detected time and an authorized destination link.
6. Owner action: Order stock. Central action: review the outlet and replenishment.

Example: “Tea premix is low — Anna Nagar: 3.00 kg remaining · alert at 3.00 kg.”
Notification clicks retain authorization; seeing an alert never grants access.

Acceptance tests: 3.01→3.00 kg, gram conversion, several batches, excluded stock,
concurrent consumption, retry duplicates, initial low balance, recovery and
recurrence, cross-franchise denial, worker outage and eventual delivery. Billing
must continue if notification delivery is unavailable. Alert latency must include
any offline billing or stock-relay delay.

## 5. Activity history

Explain who did what, where, when and the outcome. Default to recent operational
activity; keep security and technical event details accessible without clutter.
Next: show stock history alongside billing history without duplicating events,
use business-local dates consistently, and link bill/order/expense entities.
History remains read-only and cannot be edited to conceal a correction.

## 6. Interaction, accessibility and performance release gates

- Keyboard-operable controls, visible focus, associated labels and status/error
  announcements; verify desktop, tablet and 360 px mobile layouts.
- Filters preserve context across navigation; failed requests show retry actions.
- Cache reference catalogs where safe; scope cache keys by authorization context.
  Avoid shared caching of owner financial data without tenant-safe invalidation.
- Paginate growing histories and orders; index real outlet/date query patterns.
- Measure query count, payload and p50/p95 navigation time against representative
  multi-outlet data before claiming speed improvements.
- Target local interaction feedback within 100 ms and report p95 below 2 seconds
  under agreed test conditions; these are targets, not measured results.
- Run role-isolation, billing/refund, ordering/payment/receipt and alert-delivery
  tests in isolated databases. Complete authenticated browser walkthroughs.

## Release sequence

1. Validate this navigation/report/history pass with representative owner data.
2. Complete owner home metrics, order history, units and receiving interactions.
3. Implement threshold rules, alert state/outbox, worker and notification links.
4. Complete billing/offline/stock end-to-end tests and responsive accessibility QA.
5. Pilot with a franchise, measure task time/errors and fix observed friction.
6. Then redesign central admin's broader catalog, fulfilment and oversight tools.

Do not label the whole product production-ready until these gates pass.


## Implementation update — 2026-09-15

Owner order history now uses bounded cursor pagination and shows named supplies,
ordered/dispatched/received quantities, delivery stages and saved-payment recovery.
Order creation reuses a client reference and serializes retries, rejecting a
changed basket under an existing reference. Receipt UI lists outstanding central
shipments and validates accepted + damaged + missing quantities before posting
through the existing ledger/discrepancy workflow.

Central has an Items & supply catalogue screen for material setup, pack pricing,
GST, HSN and availability. Stock setup validates the actual Billing outlet scope.
Remaining production prerequisites are captured in stock-alert-rollout.md.
