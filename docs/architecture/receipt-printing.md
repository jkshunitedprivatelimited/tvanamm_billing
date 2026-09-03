# Receipt and Printing Plan

## Confirmed Customer Receipt Content

- Configured outlet logo.
- Outlet/brand display name.
- Outlet address and available contact details.
- Optional GSTIN when configured.
- Receipt number in `YYYYMMDD-T01-000001` format.
- Business date and time.
- Product, add-ons, quantity, GST-inclusive unit price, discount, and line total.
- Optional product/bill notes as plain text.
- Subtotal, total discount, Cash round-off when applicable, and final total.
- Payment method: Cash or UPI.
- Configurable footer/thank-you text.

The customer receipt does not display:

- employee name or employee ID;
- discount reason;
- refund reason;
- internal shift, terminal UUID, audit ID, or authorization information;
- GST breakdown into taxable value, CGST, or SGST.

Employee identity and reasons remain attached to internal financial/audit records.

## Printer Layouts

- Support both 58mm and 80mm thermal printers.
- Each registered terminal stores its configured paper width.
- Receipt rendering uses one semantic receipt model and two tested layouts; it
  does not maintain separate financial calculation code.
- Text wraps deterministically and totals remain aligned at both widths.
- Long product/add-on names and notes never overlap amounts.
- Logo is converted to a small monochrome printer-ready asset when configuration
  changes rather than processed during every checkout.
- If logo printing fails or the printer lacks image support, print a text header
  and complete the receipt.

## Printing Behavior

- A bill is complete before printing begins.
- Print failure never rolls back or duplicates a bill.
- Employee sees `Retry print` without resubmitting checkout.
- Reprints use the immutable stored receipt snapshot.
- Every print/reprint attempt records bill, terminal, operator, time, and result.
- Bluetooth, USB/browser, and future network printers implement the same adapter
  contract.
- PWA can print a locally committed offline bill before synchronization.

## Performance

- Cache the active printer profile and preprocessed outlet logo locally.
- Lazy-load optional PDF/preview code outside the initial POS path.
- Generate printer commands from structured receipt data rather than screenshot
  capture.
- Keep print payload compact and avoid embedding original large logo files.

## Required Tests

- Golden output tests for 58mm and 80mm layouts.
- Long names, multiple add-ons, discounts, notes, and maximum totals.
- Cash round-off and exact UPI totals.
- Logo success and text fallback.
- Offline printing.
- Disconnect during print and safe reprint.
- Employee identity and internal reasons never appear on customer output.

