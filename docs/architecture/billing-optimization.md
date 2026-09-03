# Billing Optimization Plan

Optimization is part of the initial design and acceptance criteria.

## Data Lifecycle

- Keep only 60 days in the hot operational query path.
- Generate an owner-requested or JKSH-generated Excel export before hot removal.
- Store the canonical older record in compressed, immutable object storage.
- Keep a small archive manifest in PostgreSQL containing outlet, date range,
  totals, counts, checksum, export state, and audit metadata.
- Delete hot rows only after archive and export verification.
- Run lifecycle work as idempotent, resumable background jobs.

## Database

- Select only required columns.
- Use cursor pagination for bill history.
- Add composite indexes for outlet/date/receipt, outlet/employee/shift,
  bill/lines, payment/refund status, and archive eligibility.
- Store money using decimal/numeric types, never floating point.
- Calculate reports server-side and maintain reconciled daily/shift summaries.
- Review query plans using production-sized test data.
- Introduce table partitioning only when measurements justify it.

## API and Jobs

- Return compact, versioned models and compressed responses.
- Use background jobs for Excel, notifications, reporting, and archival.
- Stream completed exports from object storage rather than API memory.
- Reuse a valid export for the same outlet/date range and data version.
- Add request correlation IDs, timing metrics, bounded retries, and idempotency.
- Never cache tenant financial data in a shared public cache.

## POS Frontend

- Route-split POS, Admin, Reports, and Archive features.
- Keep Excel, PDF, reporting, and optional printer libraries out of initial POS
  JavaScript.
- Cache only versioned application/menu assets.
- Index the IndexedDB outbox by state, receipt number, and creation time.
- Remove synchronized device payloads after a short recovery period.
- Virtualize large menus and paginate history.
- Enforce optimized image formats and upload-size limits.
- Refetch affected records instead of entire datasets.

## Offline Synchronization

- Send pending commands in bounded batches and receipt order.
- Use exponential backoff with jitter.
- Never automatically replay a mutation without an idempotency key.
- Pause conflicts for explicit resolution instead of retrying forever.
- Display pending count and oldest pending age.
- Never let logout or cache cleanup erase unsynchronized bills.
- Alert when pending bills approach the 24-hour authorization limit.

## Initial Performance Budgets

- Cached POS interactive in under 2 seconds on target hardware.
- Add-to-cart response under 100 ms.
- Online checkout p95 under 1.5 seconds, excluding printing.
- PIN validation p95 under 500 ms online.
- First 60-day history page p95 under 1 second.
- Offline IndexedDB bill commit under 300 ms.
- No initial compressed route chunk above 250 KB without review.

Test these budgets on representative low-cost store hardware and realistic Indian
mobile/broadband network conditions.

## Monitoring

Measure API and database latency, error rate, sync backlog, oldest pending bill,
export duration, archive failures, duplicate command attempts, and terminal
offline age. Archive/export verification failure must retain hot records and alert
JKSH operations automatically.
