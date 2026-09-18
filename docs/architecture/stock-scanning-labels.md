# Stock Scanning and Label Printing

## Supported Scanning

Stock supports USB/Bluetooth keyboard-style scanners and phone/tablet camera
scanning. Barcode, QR, supplier code, JKSH code, and pack aliases map to one Stock
item and unit conversion. Scans never supply trusted tenant, price, batch, or
quantity without normal validation.

## Workflow

- Scanning targets the active receive/count/transfer/dispatch/inward field and
  gives immediate visible plus optional sound/vibration feedback.
- Repeated scans increment by configured pack quantity with undo before confirm.
- Unknown, ambiguous, inactive, and wrong-scope codes show recovery guidance.
- Manual lookup remains available. Code creation/remapping requires permission
  and reason; staff cannot silently change mappings.
- Camera permission is requested only after `Scan with camera`.
- A compact versioned alias cache supports permitted offline operations.

## Thermal Labels

Ordinary supported thermal printers print configurable internal labels with item
name/code, barcode/QR, batch, manufacture/received date, expiry, quantity/unit,
and optional internal location. Templates support common label width/DPI through
print CSS or PDF.

Supplier cost, raw tenant IDs, and confidential data are excluded by default.
Reprinting is audited and never creates or adjusts Stock. Print failure leaves
the underlying movement complete and provides reprint.

## Performance and Tests

- Cache immutable mappings by version and lazy-load camera decoding.
- Debounce hardware input without losing rapid scans.
- Test scanner/camera input, pack conversions, rapid duplicates, unknown codes,
  tenant scope, offline aliases, mapping permission, label content, print failure,
  and reprint audit.
