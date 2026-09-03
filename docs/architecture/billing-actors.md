# Confirmed Billing Actors

Status: Confirmed for initial design.

## Design Principle

JKSH operates and administers the platform. Franchisees are JKSH customers who
receive the Billing software for their stores. Store employees are operationally
equal in the initial product: the software will not create separate Cook,
Cashier, or Store Manager roles.

Access is controlled by organization, franchise, and store membership even when
employees share the same operational role.

## Human Actors

### 1. Central Admin

Type: Internal JKSH user.

Scope: All organizations, franchises, stores, users, configuration, and platform
operations.

Expected capabilities:

- create and manage franchise customers;
- create every outlet, including JKSH-owned and franchise-owned outlets;
- create, disable, and support user accounts;
- configure companies, stores, terminals, menus, taxes, and global settings;
- view organization-wide billing activity and reports;
- investigate and correct operational problems through audited commands;
- manage feature access and security configuration;
- view security and financial audit records.

Central Admin access is powerful but every sensitive action remains audited.
Central Admin may view and manage an outlet but cannot create customer bills or
operate as a Store Employee.

### 2. Accountant

Type: Internal JKSH user.

Scope: Financial information across JKSH-authorized franchises and stores.

Initial capability direction:

- view bills, payments, refunds, discounts, shifts, and reconciliations across
  every outlet, including JKSH-owned outlets;
- view and export financial, GST, and settlement reports;
- investigate discrepancies;
- create audited financial adjustments and approve accounting corrections;
- access accounting information without managing platform security or users.

Accountants are not platform administrators. Financial adjustments never mutate
or delete the original transaction; they create linked adjustment records with a
mandatory reason and audit trail.

### 3. Franchise Owner

Type: Customer/tenant administrator.

Scope: Only their own franchise and its stores.

Expected capabilities:

- see everything related to their own stores;
- view bills, payments, refunds, shifts, discounts, and reports;
- manage their store employees;
- manage store and billing configuration allowed by JKSH;
- receive the standard Central master menu and configure permitted catalog price
  and GST/tax settings for their own outlets;
- use the store Billing interface when required;
- refund older bills belonging to their own outlets through an audited historical
  refund workflow;
- never access another franchise's information.

A Franchise Owner may operate multiple outlets under the same login. After
authentication, the application displays one card per authorized outlet. The
owner selects a card to enter that outlet's isolated workspace and can switch
outlets without creating another account.

Franchise Owners cannot create outlets. Central Admin creates an outlet and then
assigns the appropriate Franchise Owner memberships.

### 4. Store Employee

Type: Franchise/store employee.

Scope: Only the single assigned franchise outlet.

For the initial product, each Store Employee belongs to exactly one outlet. An
employee does not choose between outlets and does not maintain separate outlet
codes. Their identity is resolved to the assigned outlet after authentication.

There is no functional distinction between cook, cashier, or store manager in
the initial product. Every Store Employee may perform normal store operations,
including:

- open and operate the store Billing workspace;
- create bills;
- receive configured payment modes;
- apply permitted discounts;
- cancel/void permitted transactions;
- refund a completed paid bill when a customer cancels, with a mandatory refund
  reason;
- print and reprint receipts;
- view permitted store billing history;
- lock/unlock their terminal session;
- open and close their own operational shift if shifts are enabled;
- perform future operational kitchen/store tasks assigned to the Store role.

Employees still have individual accounts or identities so every bill, discount,
cancellation, refund, and shift is attributable to the employee who performed it.

## Non-Human Actors

- Payment Provider: sends verified payment and refund events.
- Stock System: receives versioned sale, cancellation, and refund events.
- Registered Terminal: establishes trusted store/workstation context.
- Printer: prints receipts but has no business permissions.
- Background Worker: processes reports, notifications, retries, and outbox events.

## Initial Role Set

```text
central_admin
accountant
franchise_owner
store_employee
```

These roles are combined with memberships and scopes. A role name alone never
grants access to arbitrary records.

Examples:

- `franchise_owner` + membership in Franchise A;
- `store_employee` + membership in Franchise A / Store 3;
- `accountant` + organization-wide financial scope;
- `central_admin` + JKSH platform scope.

## Explicitly Rejected for Initial Release

- separate Cook role;
- separate Cashier role;
- separate Store Manager role;
- authorization based only on a role string stored in browser state;
- shared employee accounts;
- anonymous operational billing;
- cross-franchise access;
- hard deletion of completed financial records.

## Confirmed Refund Rule

- A Store Employee may refund a completed, paid bill.
- A Store Employee may choose either a complete-bill refund or a partial refund
  containing selected bill lines and quantities.
- A non-empty refund reason is mandatory.
- Store Employees may refund only a bill generated on the same local business
  date as the refund.
- An eligible refund is processed immediately and does not wait for approval.
- Same-day eligibility is calculated by the server using the store's configured
  IANA timezone; it is not a rolling 24-hour window and does not trust the
  browser clock.
- The employee, timestamp, amount, payment mode, and original bill are recorded.
- The original bill and payment remain immutable and are never hard-deleted.
- The server calculates refundable subtotal, discount, tax, rounding, and final
  refund amount from the original bill and all previous refunds.
- Employees cannot type an arbitrary refund amount or refund a product that was
  not present on the original bill.
- Multiple partial refunds are permitted until the purchased quantity of each
  bill line has been fully refunded.
- A bill line quantity and bill amount can never be refunded more than once.
- Refund processing is atomic and idempotent to prevent duplicate refunds.
- Online refunds are reconciled with the payment provider.
- Cash refunds are included in shift cash reconciliation.
- Billing publishes a `SaleRefunded` event with the exact refunded product lines
  and quantities for Stock.
- Successful and failed refund attempts are audited.

Both complete-bill and partial item/quantity refunds are included in the MVP.

## Confirmed Discount and Price Rules

- Store Employees may apply any discount amount or percentage up to the bill's
  remaining payable value.
- A non-empty discount reason is mandatory because Store Employees have no
  configured discount ceiling.
- A discount cannot make a line or bill total negative.
- Store Employees cannot manually change or override the catalog selling price.
- The server loads the authoritative selling price and calculates the discount.
- The original unit price and applied discount are stored separately on each bill
  line so reports retain both values.
- Every applied discount records the employee, terminal, store, date, and time.
- Central maintains a standard master menu with GST-inclusive prices.
- Franchise Owners may create franchise-owned menu items in addition to using the
  Central master menu.
- The same product may have a different selling price at each outlet.
- Store Employees cannot change master or outlet prices during billing.

## Confirmed Menu, Price, and GST Direction

- Central Admin maintains the standard/master menu definitions.
- Standard menu selling prices are GST-inclusive.
- Franchise Owners may configure permitted price and GST/tax settings for their
  own outlets.
- Store Employees cannot change catalog price or tax configuration while billing.
- Each completed bill snapshots item name, inclusive unit price, applicable GST
  rate/amount, and discount so later configuration changes do not alter history.
- Customer receipts show the GST-inclusive selling price and final totals without
  a CGST/SGST/taxable-value breakdown. Internal records may retain tax data needed
  for accounting and statutory reports.
- The exact inheritance rule for Central defaults versus outlet overrides will be
  finalized in the catalog data model.

## Confirmed Refund Payout Choice

- A refund operator chooses either `cash` or `upi` as the refund payout method.
- The selected payout method, employee, outlet, amount, reason, and timestamp are
  recorded.
- A UPI sale reference is optional.
- A UPI refund reference is mandatory.

## Confirmed Store Employee Login

- A Franchise Owner creates a Store Employee using at least name and phone number.
- The system generates an employee ID.
- The employee receives/sets a four-digit personal PIN.
- Daily Store login requires only the four-digit PIN on a registered terminal.
- The employee does not enter phone number or employee ID on every login.
- A PIN must be unique within an outlet so the terminal can identify the employee.
- The PIN works only on registered terminals for the employee's assigned outlet.
- PINs are stored only as strong hashes and are never displayed after creation.
- Repeated failures trigger terminal/account throttling and temporary lockout.
- PIN reset is an authenticated Franchise Owner workflow and is audited.

## Confirmed UPI Operation

- Billing does not generate or display a UPI QR code.
- The store uses its existing external bank scanner/QR equipment.
- The employee selects `UPI` after verifying payment externally.
- Billing records the selection but does not claim bank settlement confirmation.

## Confirmed Historical Refund Authority

- Store Employees may refund only bills created on the same store-local business
  date.
- Franchise Owners may refund older bills for their own franchise outlets.
- Franchise Owner historical refunds are allowed only while the bill remains in
  the 60-day active operational period.
- Central Admin does not receive historical-refund authority merely because the
  role is globally privileged.
- Historical refunds require a reason and an immutable audit record.
- The API validates that the original bill belongs to the Franchise Owner's
  franchise and outlet scope.

## Confirmed Accountant Adjustments

- Accountants may create linked payment-method classification corrections.
- Accountants may create linked Cash-variance adjustments.
- Every adjustment requires a reason and immutable audit record.
- Adjustments never edit bill lines, original totals, payments, or refunds.
