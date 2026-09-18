# Scheduled Offers

## Boundary and Ownership

The system supports scheduled menu-item and combo offers. Coupon codes, loyalty
points, customer segmentation, and campaign messaging remain outside scope.

- Central creates brand offer drafts and publishes to selected outlets.
- Franchise Owner creates offers only for selected owned outlets.
- Store Employees cannot create or edit offers.
- Scheduling uses outlet-local date/time and optional day/time windows.

## Model and Calculation

An offer contains name/label, item/add-on/combo targets, fixed or percentage
discount, outlets, schedule, priority, state, immutable version, and audit actor.
V1 excludes buy-X-get-Y, coupon codes, customer eligibility, and usage limits.

- Authoritative GST-inclusive unit price remains unchanged; offer value is a
  separate discount allocation.
- One best applicable offer wins by deterministic priority. Scheduled offers do
  not stack with each other.
- Employee discount may apply afterward with its own mandatory reason, but total
  discount cannot exceed remaining payable value.
- Refunds use the snapshotted discount allocation, never current configuration.

## Publication, Offline, and UX

Draft -> Preview -> Publish shows targets, dates, conflicts, price impact, and
estimated margin when cost is available. Publication creates a new version and
never changes an open cart. POS caches offer versions with its menu; disconnected
behavior is bounded by configuration/offline authorization expiry. Failed targets
remain on their prior version and retry idempotently.

POS shows an uncluttered label plus original/net price. Admin/Owner sees a
calendar/list, conflicts, preview, pause, and results. Reports distinguish
scheduled-offer discounts from employee discounts.

Tests cover timezone boundaries, overlapping priority, non-stacking, manual
discount interaction, zero total, GST allocation, refunds, offline parity,
publication retry, open-cart immutability, outlet scope, pause, and expiry.
