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

Recipes are optional. A Billing menu item without a published Stock recipe is
marked `not_stock_tracked` and remains sellable; its sale event contains no recipe
reference and causes no automatic raw-material consumption.

Central maintains standard raw materials and standard recipes. Franchise Owners
may create an outlet-specific recipe version for an owned outlet. Central recipe
publications preserve outlet overrides by default and use the same reviewed
publish/force-update principles as menu publication.

## Availability Calculation

Stock calculates how many servings a recipe can produce from available required
materials. Conceptually:

```text
sellable quantity = minimum(
  floor(available material quantity / recipe requirement)
  for each required recipe material
)
```

- If sellable quantity reaches zero, Stock publishes the item as unavailable.
- Billing keeps the item visible with `Out of stock` and disables add-to-cart.
- Franchise Owner may manually pause an item in Billing even when Stock says it
  is available.
- A manual Billing pause cannot force an item available when Stock reports zero.
- Paid add-on availability is calculated from its own recipe.

## Offline Sale Allowance

Because the outlet has one active Billing terminal, Stock can publish a bounded
offline allowance for each menu item/add-on along with the availability version.

- The allowance is based on current raw materials minus a configurable safety
  buffer.
- The POS stores it in IndexedDB with the menu/recipe version.
- Each offline sale atomically decrements the local allowance.
- When allowance reaches zero, the item becomes `Out of stock` locally.
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

- A recipe version contains one fixed list of raw materials and quantities.
- Ingredient substitutions and alternative recipes are not supported in MVP.
- Editing a recipe creates a new version effective for future sales.
- Historical bills and Stock consumption retain the recipe version used at sale.
- Paid add-ons use their own optional fixed recipe versions.

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
2. Central creates standards; Franchise Owners may customize outlet recipes.
3. Recipe mapping is optional; untracked menu items remain sellable.
4. Ingredient substitutions are outside MVP.
