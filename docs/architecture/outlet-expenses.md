# Outlet Operational Expenses

## Scope

Outlets record local material purchases, cleaning items, minor repairs,
transport, and petty expenses. This supports owner visibility and Cash
reconciliation; it is not full accounting, payroll, tax filing, or accounts
payable.

## Roles and Workflow

- Store Employee records an active-outlet expense instantly with category,
  positive amount, payment source, mandatory reason, and optional receipt.
- Franchise Owner reviews, exports, reverses, and replaces records in owned
  outlets. Employee entries are highlighted until reviewed.
- Central manages standard categories and oversees every outlet.
- Accountant views expense/reconciliation reports without editing originals.

Confirmation creates an immutable expense and audit event. Corrections use a
linked reversal and replacement. Local Stock inward may reference its expense,
but physical quantity and commercial recording remain separate idempotent
commands.

## Cash-Drawer and Payment-Source Rules

An expense explicitly paid from the shared drawer reduces expected closing Cash:

```text
opening Cash 2,000 + Cash sales 5,000 - drawer expense 500
= expected closing Cash 6,500
```

Supported payment sources are:

- shared Cash drawer;
- outlet UPI;
- owner-paid;
- employee-paid.

Only `shared Cash drawer` changes expected closing Cash. The other sources do not
change the drawer. Payment source is snapshotted and cannot be silently edited.

Employee entry does not wait for owner approval. It affects reports and the Cash
session immediately, then remains highlighted until owner review. An owner who
rejects an incorrect record creates a reversal/correction instead of deleting it.

## Alerts and Evidence

- Receipt image/PDF is optional for every expense.
- Central defines a default high-value alert threshold; an owner may configure a
  stricter threshold for owned outlets.
- High-value, unusual-frequency, duplicate-looking, and repeatedly reversed
  expenses generate owner alerts but do not block recording.
- An alert is an investigation signal, not proof of misuse.

## Offline, Security, and Tests

- Registered terminals may queue an idempotent expense offline; receipt upload
  may finish later. Reversal requires online authorization.
- Receipt objects are private, validated, size-limited, and accessed through
  short-lived authorization.
- Reports filter by outlet, category, payment source, employee, review status,
  and date and support daily/monthly totals and Excel export.
- Tests cover scope, duplicate retry, reversal-only correction, post-entry owner
  review, every payment source, optional receipt failure, non-blocking alerts,
  Stock-link independence, offline sync, and Cash closing reconciliation.
