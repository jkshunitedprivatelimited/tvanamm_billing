# Billing History and Refund Workflow

## Store Employee History

- A Store Employee can see all bills from their assigned outlet for the current
  outlet-local business date.
- Access is not limited to bills created by that employee.
- History uses server-side cursor pagination and receipt-number search.
- During an outage, the terminal shows locally available synchronized and pending
  bills clearly labeled by sync state.
- A Store Employee cannot browse previous business dates.

## Reprinting

- Any Store Employee can reprint any current-day bill from their outlet.
- Reprinting uses the immutable receipt snapshot and never reruns checkout.
- Every attempt records the acting employee, terminal, bill, time, and result.
- Employee identity remains absent from the customer copy.

## Unpaid Cart Cancellation

- An unpaid cart is temporary local UI state, not a financial transaction.
- Employee may discard it immediately.
- Discarding an unpaid cart does not create a bill, cancellation, refund, or audit
  record in the MVP.
- Once checkout is durably committed, the cart cannot be treated as unpaid or
  restored for editing.

## Completed Bill Immutability

- A paid/completed bill is never edited, voided, or hard-deleted.
- Corrections happen only through a linked full or partial refund.
- Store Employees can refund current-day outlet bills online.
- Franchise Owners can refund older bills for owned outlets only during the
  60-day active operational period. Archived bills are read-only and cannot be
  refunded.
- The system calculates refundable lines, quantities, discounts, rounding, and
  totals from the original snapshot and prior refunds.
- Refund reason and Cash/UPI payout choice are mandatory.
- The selected refund payout method may differ from the original sale payment
  method. A UPI refund still requires its own reference.

## Bill Status

Status is derived from immutable bill and refund records:

```text
completed
partially_refunded
fully_refunded
```

Sync state is separate:

```text
pending_sync
syncing
synced
sync_failed
```

Financial status and synchronization state must never be combined into one
ambiguous field.

## Optimization

- Default history query is outlet + business date with a matching composite
  index.
- List rows use compact summaries; bill lines load only when a bill is opened.
- Current-day updates invalidate only the affected receipt/list entry.
- Reprints use stored structured snapshots and cached printer assets.
- Refundability is calculated server-side and returned with bill detail.
