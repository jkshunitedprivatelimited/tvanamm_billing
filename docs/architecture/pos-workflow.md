# POS Workflow Plan

## Confirmed MVP Scope

- Products do not have variants such as Small/Medium/Large or Hot/Cold.
- Products may have add-ons.
- Out-of-stock products remain visible but cannot be added to a new cart.
- Bills do not classify orders as Dine-in, Takeaway, or Delivery.
- Billing does not generate a kitchen order ticket or preparation token.
- Sales are anonymous by default. Customer name/mobile fields are optional and
  collapsed so checkout does not prompt for them.
- Paid add-ons receive the same applicable discount as their base product.
- Store Employees may add optional product-line or bill notes.
- The MVP produces printed receipts only; it does not send receipts by SMS or
  WhatsApp.
- Cash and UPI are the only payment methods.
- Store Employees cannot override product prices.
- Store Employees may apply discounts up to the payable value with a mandatory
  reason.

## Add-On Model

- Central or an authorized Franchise Owner defines reusable add-on groups.
- An add-on group may be optional or required.
- A group defines minimum and maximum selections.
- Individual add-ons may be free or have a GST-inclusive additional price.
- Add-ons may be enabled/disabled and priced per outlet.
- Store Employees select add-ons while adding the product to the cart.
- The same base product with different add-ons appears as separate cart lines.
- Completed bill lines snapshot add-on name, quantity, unit price, and total.
- Refunds can include the corresponding add-on value for the refunded quantity.
- A line discount applies to the base item and its paid add-ons as one configured
  line total; the stored snapshot retains the allocation for correct refunds.
- `SaleCompleted` and `SaleRefunded` events include add-ons relevant to Stock.
- Later Stock mapping may associate an add-on with ingredients or inventory
  consumption without giving Stock access to Billing tables.

## Primary Sale Flow

1. Employee unlocks the registered terminal using their four-digit PIN.
2. Employee confirms/resumes their Billing shift and shared Cash session.
3. POS loads the outlet's versioned menu.
4. Employee searches or chooses a product.
5. If configured, POS opens its add-on selector and validates selection rules.
6. Employee optionally enters a short product note, adds the configured line to
   cart, and changes quantity as needed.
7. Employee optionally applies a discount and enters the mandatory reason.
8. POS displays the GST-inclusive subtotal, discount, payment total, and Cash
   round-off where relevant.
9. Employee selects Cash or UPI and confirms payment received externally.
10. Online mode submits an idempotent `CreateBill`; offline mode commits it to
    IndexedDB and the synchronization outbox.
11. Receipt prints and the cart clears only after durable commit.
12. Billing publishes `SaleCompleted` only after server synchronization/commit.

## Optimization Rules

- Menu response is compact and versioned.
- Add-on groups are referenced rather than duplicated in every live menu payload.
- Search runs locally over the cached outlet menu.
- Cart calculations use shared pure code and do not call the server per click.
- Product and add-on images are optional, optimized, and lazy-loaded.
- Checkout performs one command, not separate bill/payment/line requests.

## Note and Customer-Data Defaults

- Customer details are never required for checkout.
- The default customer label is `Walk-in Customer` without storing fake PII.
- Optional customer details are stored only when deliberately entered.
- Notes are trimmed, length-limited, treated as plain text, and never rendered as
  HTML.
- Product notes are attached to their bill line; bill notes are attached to the
  bill.
- Notes are included on the printed receipt beneath the relevant line/bill unless
  future receipt policy marks them internal.
