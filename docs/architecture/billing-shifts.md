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
12. Forgotten shifts are not silently rewritten. A Franchise Owner can force-close
   one with a mandatory reason, and the system marks it as `force_closed`.

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
4. Cash bills and Cash refunds update the expected shared drawer balance.
5. At outlet/day closing, an authorized Store Employee or Franchise Owner enters
   one total counted Cash amount.
6. Denomination details are optional and do not replace the final total.
7. The system calculates expected Cash and variance.
8. A non-zero variance requires a reason.
9. Closing the Cash session is separate from ending an employee shift or logging
   out.

The MVP permits one open Cash session per outlet at a time. This avoids assigning
the same physical money to several employee shifts.

## Security and Consistency Rules

- Server time and the outlet timezone determine shift timestamps and business
  date; browser time is not trusted.
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
- Forgotten shifts are force-closed by the Franchise Owner with a reason; there
  is no silent automatic close in the MVP.
