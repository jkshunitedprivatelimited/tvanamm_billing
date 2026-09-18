# Operational Notifications Plan

## Channels

- In-app notifications are the authoritative operational channel.
- SMS is used only for authentication OTP in the initial product.
- Operational SMS, WhatsApp, email, and push campaigns are outside scope.
- Printed receipts remain the only customer receipt-delivery method.

## Notification Types

- security: new login, account/terminal disabled, suspicious PIN/OTP activity;
- Billing: offline age, sync failure, receipt allocation, export/archive outcome;
- Stock: negative balance, low cover, expiry, count discrepancy, unreviewed
  inward, failed event, recall, and return action;
- Stock commerce: order/payment/dispatch/backorder/inward/credit-note state;
- workforce: missing checkout, optional schedule lateness, and corrections;
- expenses: high-value/unusual activity, pending owner review, reversal, and
  receipt-processing failure;
- Cash control: high-value top-up/drop/deposit, pending offline movement, and
  close mismatch;
- supplier finance: invoice due/overdue, duplicate or PO/receipt mismatch,
  dispute, unallocated payment, and reversal;
- system: import completion/failure, background-job failure, maintenance, and
  configuration requiring attention.

## Delivery and UX

- Notification records carry recipient scope, severity, category, entity link,
  created time, read time, and deduplication key.
- Header badge shows unread actionable count; notification center groups by
  Today, Earlier, and Resolved.
- High-severity unresolved issues also appear as persistent dashboard banners.
- Opening a notification routes to the authorized filtered record; a notification
  never grants access by itself.
- Repeated events update/group one notification where appropriate instead of
  flooding users.
- Users may mute informational categories, but not security, financial-integrity,
  recall, or data-loss alerts applicable to their role.

## Reliability and Cost

- Create notifications asynchronously from committed events/outbox records.
- Use idempotent deduplication and bounded retries.
- Mark delivery/read state separately from the business event.
- Paginate history and maintain unread counters without full-table scans.
- Retention is category-specific; audit/security evidence outlives UI inbox
  presentation where policy requires it.

## Acceptance Tests

- correct role/outlet/fr scope and denied cross-tenant access;
- duplicate events create one grouped notification;
- unread/read/resolved counters reconcile;
- failure never rolls back the originating bill, Stock movement, or payment;
- mandatory categories cannot be muted;
- links preserve authorization and route to the correct context;
- no SMS is sent for operational events.
