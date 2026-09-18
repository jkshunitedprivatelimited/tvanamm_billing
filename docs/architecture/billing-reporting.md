# Billing Dashboards and Reporting Plan

## Confirmed Franchise Owner Navigation

1. Franchise Owner authenticates with mobile SMS OTP.
2. Landing dashboard shows a combined view across all owned outlets.
3. Outlet cards display identity and a compact operational summary.
4. Selecting a card enters that outlet's isolated dashboard and reports.
5. A persistent outlet switcher returns to the portfolio or another owned outlet.
6. API authorization derives permitted outlet IDs from memberships; the browser
   cannot access an unrelated outlet by changing a URL.

## Confirmed Date Filters

- Today
- Yesterday
- Last 7 Days
- Last 30 Days
- Custom Date Range

Custom dates use each outlet's business timezone. Combined reports normalize
date boundaries per outlet before aggregation.

## Confirmed Financial Date Treatment

- A completed bill remains reported on its original business date.
- A refund is reported as a negative financial movement on the refund business
  date.
- Creating a later refund never rewrites the original sale-day totals.
- Net sales for a selected period equal sales recognized in that period minus
  refunds performed in that period.
- Bill detail links the original sale and every later refund for reconciliation.

## Confirmed Monthly Report

- Generate the previous calendar month's report automatically after month close.
- Run generation as a background job, never during a dashboard request.
- Scope the report to the Franchise Owner's outlets.
- Include outlet-by-outlet breakdown and a combined summary.
- Store report version, generation state, totals, checksum, and audit metadata.
- Notify the owner through the in-app notification center when ready.
- Provide a short-lived authenticated download rather than a public file URL.
- Retry safely without producing duplicate report versions.

## Optimization

- Dashboards query daily and shift summary projections, not full bill tables.
- Projections update after committed bill/refund events and reconcile on a
  schedule.
- Combined dashboards aggregate only authorized outlet summaries.
- Drill-down data loads only when an outlet/card is opened.
- Cache versioned, user-scoped summaries briefly; never use a shared public cache
  for financial data.
- Large custom reports and Excel exports run asynchronously.

## Confirmed Franchise Owner Metrics

- Gross sales.
- Discounts.
- Refunds.
- Outlet operational expenses by category, payment source, and review state.
- Net sales.
- Cash total.
- UPI total.
- Bill count.
- Combined values across owned outlets and individual outlet drill-down.

## Confirmed Central Admin Dashboard

- The same financial metrics across every JKSH-owned and franchise-owned outlet.
- Brand, franchise, and outlet filters.
- Combined JKSH totals with drill-down by brand, franchise, outlet, terminal,
  employee, document, and underlying immutable audit events.
- Active, suspended, and closed outlet counts.
- Registered terminal state and last synchronization time.
- Pending/failed offline synchronization indicators.
- Archive/export/report job failures.
- Drill-down without permission to create customer bills.

## Complete Audit Reporting

Authorized Central users can filter/export audit activity by date, actor, role,
brand, franchise, outlet, terminal, domain, entity, action, outcome, risk level,
correlation ID, and AI-assisted/manual source. Drill-down links the business
record, prior/new version or reversal, related event/job, and authorization
decision where retained.

Audit reports never expose OTPs, PINs, secret values, raw session tokens, private
bank credentials, or unrestricted customer/employee personal data. Audit events
are append-only, paginated, integrity-monitored, and exported asynchronously.
Anomaly filters are review signals and never automatically accuse or suspend a
person/outlet.

## Confirmed Accountant Dashboard

Accountant is an internal JKSH-only role. Central Admin creates and manages
Accountant access; Franchise Owners cannot grant it.

- Net sales and gross sales.
- Cash and UPI reconciliation.
- Shared-drawer expenses and their impact on expected closing Cash.
- Refunds and audited adjustments.
- GST/tax reporting totals retained internally.
- Outlet and combined financial reports.
- Excel export jobs and archive manifests.
- No outlet/user/platform-security management.

## Confirmed Monthly Notification

- Monthly report readiness uses in-app notification only for MVP.
- The notification opens the authenticated report/download screen.
- No SMS, email, or public report link is sent.
