# Bulk Import and Data Quality Plan

## Scope

Central Admin can import approved Excel templates for:

- brands, franchises, and outlets where applicable;
- menu categories, items, add-ons, combos, outlet prices, GST/HSN mappings, and
  availability;
- employees and outlet assignment;
- Stock materials, units, pack conversions, supply classification, and suppliers;
- recipes and recipe lines;
- opening Stock balances, batches, expiry dates, and costs.

Franchise Owners may import only owner-managed data within owned outlets, such as
local materials, local inward, private menu drafts, and employees. Imports never
grant access or create Central-controlled tax profiles, outlets, or recipes.

## Safe Workflow

```text
Download template -> Upload -> Parse -> Validate -> Preview -> Confirm -> Process
                  -> Result summary -> Correct/retry failed rows
```

- Template includes version, instructions, required columns, examples, and
  controlled-value sheets.
- Uploading never changes live data.
- Preview reports valid rows, warnings, errors, duplicates, targets, and whether
  each row creates, updates, or skips.
- Confirmation creates an immutable import job with actor and file checksum.
- Processing uses bounded background batches and idempotent row keys.
- Partial success is visible by row. Retrying cannot duplicate successful rows.
- Menu imports create drafts; they never bypass Preview/Publish.
- Opening Stock imports create controlled opening movements, never direct balance
  edits.
- Recipe imports create Central-owned draft versions, never rewrite history.

## Validation

- Reject cross-tenant/outlet references and unauthorized targets.
- Validate phone formats, uniqueness, units, pack conversions, quantities,
  decimal precision, dates, expiry, GST/HSN profile, and required relationships.
- Detect duplicate rows inside the file and conflicts with current records.
- Resolve references through stable business codes, not raw database UUIDs.
- Formula cells are read as values; macros and executable content are rejected.
- Limit file size, sheet count, row count, and decompression ratio.
- Virus-scan uploads where deployment infrastructure supports it.

## Correction and Rollback

Confirmed financial, inventory, published menu, or identity records are not
deleted by rollback. Before confirmation, an import can be discarded. After
processing:

- draft-only creations may be archived through an authorized bulk undo job;
- published/live corrections use normal versioned publication;
- Stock corrections use reversing movements;
- employee/account corrections use authorized lifecycle commands;
- every correction links to the import job and original row.

## Performance, Security, and Retention

- Store uploads privately with short-lived access; never expose public object
  URLs.
- Parse/process asynchronously outside request handlers.
- Stream large workbooks and bound concurrency to protect the database.
- Keep progress and row errors queryable without loading the full workbook.
- Retain file checksum, template version, actor, summary, and audit evidence.
  Delete raw uploads after the configured diagnostic window unless a legal or
  recovery requirement applies.
- Never include OTPs, PINs, secrets, or payment credentials in templates.

## Acceptance Tests

- valid create/update/skip preview and confirmation;
- invalid tenant, duplicate, unit, GST/HSN, phone, batch, expiry, and recipe rows;
- malicious/oversized workbook rejection;
- repeated confirmation and worker retry remain idempotent;
- menu/recipe imports remain drafts;
- opening balances reconcile exactly to ledger movements;
- owner cannot import into another outlet or Central-only domain;
- partial failure export identifies source row and actionable error;
- archive/correction preserves audit and immutable history.
