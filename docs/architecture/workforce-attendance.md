# Workforce Attendance and Activity Boundary

## Scope

The platform includes lightweight employee attendance and operational activity
for Central and Franchise Owner visibility. It is not payroll or a full HRMS.

Included:

- attendance check-in and check-out;
- late, missing-checkout, and unusual-duration flags;
- employee POS and Stock activity summaries;
- outlet/date/employee filtering and Excel export;
- owner correction with a mandatory reason;
- Central cross-outlet oversight and audit.
- optional outlet/employee schedules and late-arrival flags.

Excluded:

- salary, incentives, deductions, payslips, loans, and advances;
- leave accrual/approval and holiday payroll rules;
- PF, ESI, professional tax, TDS, and statutory payroll processing;
- biometric hardware dependency, face recognition, or continuous tracking.

## Separate Concepts

```text
employee PIN login -> identifies the current operator
attendance session -> records presence at the outlet
Billing shift      -> attributes POS activity
Cash session       -> reconciles the shared physical drawer
```

One action never silently creates, closes, or edits another record. The UI may
offer `Check in and start shift`, but the server commits two independently
auditable commands.

## Workflow and Permissions

1. Employee selects their profile and authenticates with their four-digit PIN on
   the registered outlet terminal, then explicitly checks in. No selfie, GPS, or
   biometric attendance proof is required.
2. Server records outlet-local business date, server time, terminal, employee,
   and original device time.
3. Employee explicitly checks out when leaving.
4. A forgotten session is flagged after the outlet-day boundary; the system
   never invents a checkout time.
5. Franchise Owner may correct an owned-outlet record with a reason. The original
   stays immutable and the correction is linked.

Schedules are optional. When configured, they provide expected start/end times
and a configurable grace period for late flags. Missing or late attendance is a
review signal and does not automatically block login, Billing, or Stock work.

- Store Employee: act only for themselves and view recent personal records.
- Franchise Owner: view, export, and correct owned-outlet attendance and view
  employee activity.
- Central Admin: oversee all outlets and configure schedules.
- Accountant: no attendance-management capability by default.

## Activity Reporting

Reports may show bills, discounts, cancellations, refunds, shift/Cash actions,
inward, count, wastage, availability changes, and first/last activity. These are
review signals, never automatic proof of misconduct or payroll inputs.

## Offline, Cost, and Tests

- Registered terminals may queue encrypted, idempotent attendance commands in
  IndexedDB; conflicting sessions become owner-review exceptions.
- Missing attendance does not block emergency Billing.
- Use indexed outlet/date and employee/date queries and daily projections.
- Large exports are asynchronous.
- Attendance retention follows JKSH HR/legal policy, not Billing's 60-day hot
  history rule.
- Tests cover duplicate retries, scope denial, correction history, offline time
  preservation, optional schedule/grace calculations, shift independence, and
  report reconciliation.
