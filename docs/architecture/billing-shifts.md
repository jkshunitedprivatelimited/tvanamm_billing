# Billing Shift Tracking Plan

Status: Core flow confirmed; implementation defaults selected.

## Purpose

Shift tracking connects a Billing operator to POS activity. It is not general
attendance tracking. Cash responsibility belongs to a separate shared outlet
drawer session because the outlet uses one common Cash drawer.

## Proposed Employee Flow

1. The outlet terminal is already registered and assigned to one outlet.
2. The employee enters their four-digit PIN.
3. The screen displays the resolved employee's name so they can verify their
   identity.
4. If an open shift exists, the employee can resume it.
5. Otherwise, the screen asks the employee to confirm `Start Shift`.
6. The system records `started_at` using server time only after confirmation.
7. Every bill, discount, cancellation, and refund records the employee and shift.
8. `Lock` hides the POS but keeps the employee's shift open.
9. Another employee may enter their PIN and use their own operator context.
10. `End Shift` records `ended_at` and calculates the employee's activity. It
    does not close the shared outlet Cash drawer.
11. The employee may start another separate shift later on the same business day.
12. At midnight in the outlet timezone, the system force-closes prior-day shifts
   and cash sessions with an explicit reason and audit event. A Franchise Owner
   can also force-close a shift manually with a mandatory reason.

## Employee Shift Summary

Each closed shift can show:

- employee and outlet;
- start and end time;
- number and value of bills;
- Cash sales;
- UPI sales;
- discounts;
- cancellations;
- Cash refunds;
- UPI refunds;
- net Cash and net UPI totals;
- force-close status and reason, if applicable.

## Shared Outlet Cash Session

The Cash drawer is tracked independently from employees:

1. The first authorized operator opens the outlet Cash session and enters the
   opening Cash amount.
2. Multiple employee shifts may operate during the same Cash session.
3. Only one employee is the active operator on a particular terminal at a time.
4. Cash bills, Cash refunds, and confirmed operational expenses paid from the
   shared drawer update its expected balance. Outlet UPI, owner-paid, and
   employee-paid expenses do not affect the drawer.
5. At outlet/day closing, an authorized Store Employee or Franchise Owner enters
   one total counted Cash amount.
6. Denomination details are optional and do not replace the final total.
7. The system calculates expected Cash and variance.
8. A non-zero variance requires a reason.
9. Closing the Cash session is separate from ending an employee shift or logging
   out.
10. Any logged-in Store Employee may close the shared Cash session using their
    own PIN-authenticated operator context.
11. Once closed, the Cash session cannot be reopened or edited. The Franchise
    Owner may view it; any valid correction is a separate audited adjustment.

The MVP permits one open Cash session per outlet at a time. This avoids assigning
the same physical money to several employee shifts.

```text
expected Cash = opening Cash
              + Cash sales
              - Cash refunds
              - operational expenses paid from the shared drawer
              + Cash top-ups
              - Cash drops
              - bank deposits
```

Every mid-day Cash movement is a separate immutable record with type, amount,
employee, time, and mandatory reason. Corrections use linked reversals. Details
are defined in `docs/architecture/cash-movements.md`.

## Security and Consistency Rules

- Server time and the outlet timezone determine shift timestamps and business
  date; browser time is not trusted.
- The business date is the outlet-local calendar date and ends at midnight.
- An open employee shift or Cash session cannot continue into the next business
  date. The database job closes expired records on its first tick after local
  midnight and catches up after downtime. The POS requires a new register and
  shift before billing resumes on the new date.
- Only one open shift per employee is permitted at a time.
- Multiple closed shifts per employee per business date are permitted.
- Multiple employees may have open shifts simultaneously.
- Only one employee context may actively control a terminal at a time.
- A Store Employee cannot close or resume another employee's shift.
- A Franchise Owner may view and force-close shifts only in owned outlets.
- Central Admin may view/manage shift problems but cannot generate bills.
- Closed shifts are immutable; corrections create linked adjustment records.
- Lock, switch employee, end shift, and logout are distinct audited actions.

## Confirmed Implementation Rules

- One shared Cash drawer per outlet.
- Cash opening/closing belongs to an outlet Cash session, not an employee shift.
- One active Billing operator per terminal at a time.
- Multiple employee shifts may remain open simultaneously.
- Switching operator locks the previous operator context; it does not silently
  close their shift.
- Closing Cash is entered as one total; denomination details are optional.
- A non-zero Cash variance requires a reason.
- Any logged-in Store Employee may close the shared Cash session; the closing
  employee is permanently recorded.
- A closed Cash session is immutable and cannot be reopened by the Franchise
  Owner.
- Forgotten shifts and cash sessions are automatically force-closed at local
  midnight, with an audit trail. Cash count and variance remain null because no
  physical count occurred; expected cash is retained for reconciliation.
- Automatic closure does not invent attendance checkout times or open a new
  register. Staff enter the opening cash and start a new shift as usual.
- The `billing-midnight-close` pg_cron job runs every minute. Monitor
  `cron.job_run_details` for failures. Environments without pg_cron must schedule
  `select billing.close_expired_business_days()` externally.
- Offline sales must still sync before day-end. Unsent sales remain in the device
  queue and follow the existing new-day register/shift requirements when syncing.

## Franchise owner register control

Owners use `/registers` in the admin portal, also linked from Cash reports, to
review and close any open register in their franchise at any time. This works
independently of the midnight scheduler. The review shows opening cash, cash
sales, refunds, drawer expenses, expected cash, and remaining shifts. The owner
enters a verified physical cash count and a required closure note. A changed
expected balance requires refreshing the review before confirmation.

The owner may end remaining shifts for that business date and earlier in the
same transaction, without staff PINs or attendance checkout. The closing record
stores `closed_by_account_id` and audit events identify the owner. Closed records
stay immutable. Staff can immediately open a new register from billing with a
fresh opening cash amount, including on the same business date. Refresh an
already-open billing screen after remote closure.

Migration `0040_owner_register_close.sql` is required for owner closure. It does
not enable the midnight job or close any live records; scheduler activation is
separate in migration `0039_midnight_cash_close.sql`.
