# Supplier Invoices and Payment Tracking

## Boundary

Stock tracks Central supplier invoice obligations sufficiently for purchasing,
due-date control, landed cost, and Accountant reconciliation. It does not provide
a general ledger, bank feed, vendor portal, or statutory accounting suite.

## Invoice and Inward Rules

- Finalizing supplier inward requires a supplier invoice number.
- Invoice attachment is optional and stored privately when supplied.
- A delivery without the final invoice number may be recorded as a receiving
  draft/quarantine record but cannot finalize the commercial inward.
- Supplier + invoice number is unique within the JKSH organization unless an
  authorized credit/debit-note workflow explicitly references it.
- Invoice snapshots supplier, PO/receipt links, invoice/due dates, taxable value,
  GST, charges, discounts, rounding, and total.
- One invoice may cover multiple receipts/PO lines and one PO may receive multiple
  invoices; allocations reconcile quantities and values explicitly.
- Corrections use credit/debit notes or reversal/re-entry, never editing a posted
  invoice silently.

Supplier returns link the original PO, receipt, invoice, item/batch, and quantity.
Replacement, credit note, or refund resolution changes outstanding allocations
without rewriting the invoice. Return quantity is capped by accepted quantity
minus prior returns, and unusable goods move to quarantine before dispatch.

## Payment Lifecycle

```text
unpaid -> partially_paid -> paid
       -> overdue
       -> disputed -> resolved
```

- Status is derived from immutable invoice allocations, payment records, and due
  date; it is not a freely editable label.
- Central Admin and Accountant may record/reconcile supplier payments.
- Warehouse staff may receive goods and attach invoice evidence but cannot mark
  an invoice paid.
- Payment captures date, amount, mode, reference, payer account label, actor, and
  optional evidence. No bank credentials are stored.
- Partial and combined payments are allocated explicitly; over-allocation and
  duplicate reference use are rejected or flagged according to policy.
- Payment reversal is linked and audited.

## Reporting and Notifications

Dashboards show due today, upcoming, overdue, disputed, unallocated payments,
supplier aging, invoice/PO/receipt variance, input-tax summary fields, and landed
cost impact. In-app alerts cover approaching due date, overdue, duplicate-looking
invoice, amount mismatch, and payment reversal.

## Performance and Tests

- Index organization/supplier/status/due date and invoice/reference keys.
- Maintain payable summaries asynchronously from committed records.
- Store attachments privately with short-lived access and retention policy.
- Tests cover required invoice number, optional attachment, uniqueness, partial
  receipt/invoice allocation, derived states, partial/combined payment,
  overpayment, reversal, overdue timing, supplier return/replacement/credit,
  permissions, tenant isolation, and report reconciliation.
