# Shared Cash-Drawer Movements

## Scope

The shared outlet Cash session supports explicit mid-day movements:

- `cash_top_up`: Cash added to the drawer;
- `cash_drop`: Cash removed for safe keeping;
- `bank_deposit`: Cash removed for bank deposit;
- `operational_expense`: linked to an outlet expense paid from the drawer;
- `correction_reversal`: reverses an incorrect movement.

These are Cash-control records, not sales, refunds, revenue, or full accounting
journal entries.

## Workflow and Permissions

- Store Employee may record a movement only for the active outlet and open Cash
  session.
- Amount, movement type, and non-empty reason are mandatory.
- Bank-deposit reference and optional evidence may be added when available.
- Confirmation creates an immutable movement and audit event immediately.
- Franchise Owner sees every movement, receives unusual/high-value alerts, and
  reviews/corrects through a linked reversal.
- Central oversees all outlets. Accountant sees and reconciles movements but does
  not edit originals.

## Calculation

```text
expected closing Cash = opening Cash
                      + Cash sales
                      - Cash refunds
                      + Cash top-ups
                      - Cash drops
                      - bank deposits
                      - shared-drawer operational expenses
```

Every movement appears individually in closing review. It never changes a bill,
refund, or expense amount. A reversal applies the opposite Cash effect and links
to the original.

## Offline and Safety

- A registered terminal may queue a movement offline with a unique command ID.
- Duplicate synchronization returns the original result.
- Movement time uses server receipt time while preserving device time.
- Reversal, closed-session changes, and cross-outlet action require online
  authorization.
- Closing must surface pending offline movements and require synchronization or
  an explicit authorized exception before final reconciliation.

## Tests

Cover every movement type and sign, duplicate retry, cross-outlet denial,
mandatory reason, owner review, high-value alert, reversal, offline ordering,
concurrent close, closed-session rejection, and exact closing reconciliation.
