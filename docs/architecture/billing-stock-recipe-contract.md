# Billing–Stock Recipe and Raw-Material Contract

## Confirmed Domain Ownership

### Billing owns

- sellable menu items and add-ons;
- outlet selling prices and GST-inclusive totals;
- carts, bills, payments, discounts, and refunds;
- customer-facing menu availability projection;
- immutable sale-line snapshots.

### Stock owns

- raw materials such as tea powder, milk, sugar, cups, and packaging;
- material units and unit conversions;
- purchases, receipts, adjustments, wastage, and current quantities;
- versioned recipes/BOMs for menu items and paid add-ons;
- raw-material consumption caused by completed sales;
- calculated sellable capacity/availability.

Neither system accesses the other system's tables.

## Menu and Recipe Setup

The Admin experience presents one coordinated workflow, but writes through two
separate APIs:

1. Create or edit the Billing menu item/add-on.
2. Select Stock raw materials.
3. Enter the exact consumption quantity and unit for one sold unit.
4. Validate unit compatibility/conversions through Stock.
5. Save a new immutable recipe version in Stock.
6. Link the Billing item/add-on to the published Stock recipe version through a
   versioned contract.

Stock provides a recipe-scaling preview. Central enters batch inputs, measured
usable yield, and standard serving quantity; Stock derives per-sale quantities
using fixed-point arithmetic. Billing price is never an input to recipe
consumption. The complete scaling and initial 80 ml tea rules are in
`docs/architecture/t-vanamm-recipe-standardization.md`.

Example:

```text
Menu item: Masala Tea
Recipe v3 for one cup:
  tea powder     8 g
  milk         120 ml
  sugar         10 g
  paper cup      1 each

Paid add-on: Extra Ginger
Recipe v1:
  ginger         4 g
```

Recipe changes create a new version and never rewrite consumption history.

Recipes are optional. A Franchise-created item can be sold immediately in its
selected outlet(s) without a recipe and is marked `not_stock_tracked`. Its sales
do not automatically consume ingredients. A packaged resale item may use a
one-to-one recipe. Linking a recipe later affects future sale snapshots only.

Central alone maintains, versions, and publishes recipes. Franchise Owners and
Store Employees may view recipes but cannot edit or publish them. Franchise
Owners may create private Billing menu items that become immediately available
to their selected outlet(s) and remain visible to Central oversight.

## Availability Calculation

Stock calculates how many servings a recipe can produce from available required
materials. Conceptually:

```text
sellable quantity = minimum(
  floor(available material quantity / recipe requirement)
  for each required recipe material
)
```

- If calculated quantity reaches zero, Stock publishes a shortage warning and
  records subsequent negative-stock exceptions; Billing remains available.
- A shortage warning by itself never adds the `Out of stock` label or disables
  add-to-cart.
- Franchise Owner may manually pause an item in Billing even when Stock says it
  is available.
- Only an explicit Billing pause keeps the item visible with an `Out of stock`
  label and blocks add-to-cart. Store Employees may pause an item for the active
  outlet; Franchise Owners and Central may manage it in their respective scope.
- Paid add-on availability is calculated from its own recipe.

## Offline Sale Allowance

Because the outlet has one active Billing terminal, Stock can publish a bounded
offline allowance for each menu item/add-on along with the availability version.

- The allowance is based on current raw materials minus a configurable safety
  buffer.
- The POS stores it in IndexedDB with the menu/recipe version.
- Each offline sale atomically decrements the local allowance and warns as it
  approaches or crosses zero.
- Exhausting a Stock allowance records an offline shortage exception but does
  not itself mark the Billing item `Out of stock`.
- The allowance expires with the 24-hour offline authorization window.
- Synchronization sends sales in receipt order and Stock consumes their recipe
  materials idempotently.
- Any reconciliation shortage becomes an explicit Stock exception; Billing never
  silently rewrites a completed bill.

This permits controlled offline selling without treating a stale `available`
flag as unlimited stock.

## Sale Event

`SaleCompleted.v1` includes only the information Stock needs:

- event, correlation, and idempotency IDs;
- organization, brand, franchise, outlet, terminal, and bill IDs;
- business date and committed timestamp;
- for each line: Billing menu-item ID, quantity, Stock recipe ID/version;
- selected add-on IDs, quantities, and Stock recipe versions.

It excludes customer identity, payment details, discount reasons, and receipt
presentation fields.

Stock records the Billing event ID on every consumption transaction. Replaying
the same event returns the previous result and never deducts materials twice.

## Refund Event

`SaleRefunded.v1` includes refunded menu/add-on quantities and original sale
references. Materials consumed for the original sale are not restored to
available stock. Stock records a wastage movement with reason
`customer_cancelled` for the corresponding prepared item/quantity. Billing never
directly changes raw-material quantities.

Because MVP has no kitchen/preparation state, a completed bill is treated as
prepared for inventory purposes. Adding a future `not_prepared` reversal would
require an explicit preparation workflow and is not inferred from a refund.

## Confirmed Recipe-Version Rules

- A recipe version contains exact fixed inputs plus explicitly modelled optional
  add-ons and approved internal alternatives.
- Billing never asks the cashier which internal ingredient alternative was
  used. Stock uses the published default and groups alternatives for Franchise
  Owner review by outlet/business date. A changed selection posts a reversal and
  corrected movement.
- Intermediate prepared batches are optional. Recorded prepared stock is
  consumed before the direct raw-material recipe, without double deduction.
- Prepared bases do not auto-expire in V1; staff records discarded quantity as
  wastage.
- Editing a recipe creates a new version effective for future sales.
- Historical bills and Stock consumption retain the recipe version used at sale.
- Free and paid add-ons use their own recipe versions.

## Failure Handling

- Billing completion does not synchronously wait for Stock consumption.
- Events are written to Billing's outbox in the same bill transaction.
- Worker delivery retries with backoff and dead-letter visibility.
- Stock consumers are idempotent.
- Stock publishes processing result and refreshed allowance/availability.
- Central sees delayed/failed Stock synchronization on the operational dashboard.
- Reconciliation compares sold recipe requirements against consumption ledger
  entries and reports discrepancies.

## Optimization

- Exchange compact recipe IDs/versions rather than complete recipes per sale.
- Publish availability changes only when sellable state/allowance materially
  changes.
- Recalculate only recipes affected by a raw-material movement.
- Batch outbox delivery without losing per-outlet ordering.
- Cache the current recipe/availability projection on the active terminal.
- Use integer base units internally (for example mg/ml/each) where practical to
  avoid floating-point drift.

## Confirmed Stock Rules

1. Refunded prepared products record wastage and do not restore materials.
2. Central alone creates and publishes recipes; Franchise Owners have read-only
   recipe access.
3. Recipes are optional. Unmapped items remain sellable with a visible
   `not_stock_tracked` status; packaged resale may map one sold unit to one stock
   unit.
4. Approved alternatives use a default plus owner-review correction workflow;
   they are not cashier-facing modifiers.
5. Ingredient shortage warns but does not block Billing. Explicitly marking a
   finished menu item `Out of stock` does block add-to-cart.

The complete SOP cleanup, supply classifications, prepared-base behavior, and
known source inconsistencies are defined in
`docs/architecture/t-vanamm-recipe-standardization.md`.
