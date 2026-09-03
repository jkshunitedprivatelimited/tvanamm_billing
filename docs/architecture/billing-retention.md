# Billing Retention, Archive, Export, and Notification Plan

## Product Behavior

- Bills remain in the active operational store for 60 days.
- Franchise Owners can view and export active bills to Excel.
- Bills older than 60 days disappear from normal POS history after a verified
  export is generated and are moved to a read-only archive.
- Day-60 processing does not permanently destroy the only financial record.
- Archived records remain isolated by franchise/outlet and accessible through an
  authorized archive/export workflow.

## Why Archive Instead of Permanent Day-45 Deletion

Billing, payment, refund, and tax records may be subject to statutory accounting
and tax retention requirements measured in years. The production retention
period must be confirmed by JKSH's accountant/legal adviser. The technical
default is eight financial years because it is safer than permanent deletion at
60 days and supports audit/reconciliation needs.

## Archive Contents

An archive preserves:

- bill header and receipt number;
- immutable bill lines and product snapshots;
- discounts and reasons;
- payments and payout modes;
- cancellations, full/partial refunds, and reasons;
- employee, shift, terminal, outlet, and timestamps;
- tax and rounding calculation fields;
- audit-event references;
- integrity checksum and archive version.

## Excel Export

Franchise Owners can request an Excel workbook scoped to their own outlets and
date range. Recommended sheets:

1. Bills
2. Bill Items
3. Payments
4. Discounts
5. Refunds
6. Refund Items
7. Shifts and Cash Sessions
8. Summary

Large exports run as background jobs. The owner receives an in-app notification
and a short-lived authenticated download link. Export creation and download are
audited.

## Notifications

- Day 53: notify Franchise Owner that records will leave active history in seven
  days; provide `Export Excel` action.
- Day 59: final reminder with active-record count and export action.
- Day 60: if the owner has not exported, JKSH generates the canonical export;
  after verification, notify that records left active history and remain in the
  compliance archive.
- Export ready/failed: notify job status.
- Archive failed: alert JKSH operations; never delete the source records.

Email notification is optional per Franchise Owner settings. In-app notification
is retained as the authoritative delivery channel.

## Archive Job Safety

1. Select eligible records by outlet-local business date.
2. Copy the complete financial aggregate to immutable archive storage.
3. Validate record counts, totals, relationships, and checksum.
4. Record archive manifest and completion audit event.
5. Verify an owner-requested or JKSH-generated Excel export exists.
6. Only after validation, remove records from the active operational store or
   mark them archived.
7. On failure, retain active records and retry idempotently.

Legal holds, unresolved refunds, accounting investigations, and failed
reconciliation suspend final retention deletion.
