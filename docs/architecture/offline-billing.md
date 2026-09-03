# Offline Billing Architecture

## Objective

A registered outlet terminal must continue creating and printing bills during an
internet outage. Offline mode must not rely on `localStorage`, ordinary browser
cache, or retrying requests blindly.

## Local Components

- PWA service worker caches the versioned application shell.
- IndexedDB stores structured offline data and a durable command outbox.
- A registered terminal credential establishes outlet and terminal identity.
- A short-lived server-issued offline authorization bundle permits known Store
  Employees to use four-digit PIN login on that outlet terminal.
- Cached outlet configuration includes receipt header, menu, outlet prices,
  GST-inclusive configuration, payment modes, and business timezone.
- Sensitive local records are minimized and protected using browser cryptography
  tied to the registered terminal where practical.

## Offline Receipt Identity

Receipt numbers must be printable immediately and collision-free across terminals.
While online, the server allocates a block of numbers to a registered terminal.

Recommended display format:

```text
YYYYMMDD-T01-000001
```

This format is confirmed and its sequence resets daily per registered terminal.

The receipt number does not contain the outlet name. The configured outlet name,
address, phone, and other available details are printed separately in the receipt
header. Unused preallocated numbers may create documented gaps but can never be
reused by another bill.

Every bill also receives a globally unique internal ID and client idempotency key.

## Offline Sale Flow

1. Employee unlocks the registered outlet terminal with their four-digit PIN.
2. The app verifies the currently valid offline authorization bundle.
3. The app loads the last server-approved menu and prices and visibly shows
   `Offline` status and the configuration timestamp.
4. Employee builds the cart and chooses Cash or externally verified UPI.
5. The local transaction validates and calculates the bill using shared versioned
   calculation code.
6. Cash uses whole-rupee rounding; UPI retains the exact two-decimal total.
7. IndexedDB atomically stores the immutable bill, lines, payment, audit event,
   receipt number, and pending `CreateBill` command.
8. The receipt prints immediately with an offline indicator if required.
9. When connectivity returns, the sync worker sends pending commands in order.
10. The Billing API recalculates, validates the idempotency key and allocated
    receipt number, commits once, and acknowledges the local command.

## Synchronization Rules

- Mutations are never synchronized through generic request replay.
- Every command has an ID, idempotency key, terminal, outlet, employee, local
  timestamp, configuration version, and receipt allocation.
- Server time becomes the authoritative synchronization timestamp while the
  original terminal timestamp is retained for audit.
- A successfully synchronized command is never submitted as a new command again.
- Failed commands remain visible with a reason and require explicit resolution.
- Bill order within one terminal is preserved.
- Billing publishes Stock events only after the server transaction commits.
- Local data is removed only after confirmed synchronization and retention rules.

## Conflict Rules

- An offline sale uses the last server-approved price snapshot shown to the
  employee; a later online price change does not rewrite the completed bill.
- Disabled products remain sellable offline only until the authorization/menu
  bundle expires.
- Revoked employees and terminals lose offline capability when their bundle
  expires; high-risk revocation cannot be instantaneous without connectivity.
- Duplicate receipt numbers or idempotency keys are rejected and investigated.
- Insufficient receipt-number allocation blocks new offline bills before a
  collision can occur.

## Restricted Offline Actions

For the MVP, offline mode permits new Cash/UPI bills and local printing. These
actions require connectivity because they depend on authoritative current state:

- full or partial refunds;
- historical bill lookup not already cached;
- employee creation or PIN reset;
- menu/price/tax changes;
- terminal enrollment;
- accounting adjustments;
- exports and archival actions.

This prevents two terminals from refunding the same item while disconnected.

## Confirmed Offline Window

- Offline authorization is valid for at most 24 hours after the terminal's last
  successful server validation.
- After 24 hours, pending bills remain safe and printable, but the terminal must
  reconnect before creating another bill.
- The UI warns before expiry and shows the remaining offline window.

## Recovery and Visibility

- Header shows `Online`, `Offline`, `Syncing`, `Sync failed`, or `Action needed`.
- Employee can see pending bill count without editing committed local bills.
- Franchise Owner can see last terminal synchronization time.
- Alerts trigger when a terminal remains unsynchronized beyond policy.
- A support workflow exports encrypted recovery data before terminal reset.
- Clearing browser data is treated as destructive and requires warnings.
- Reinstall/re-enrollment cannot reuse unconfirmed receipt-number allocations.

## Required Tests

- Browser refresh and restart preserve pending bills.
- Network loss during checkout creates one local bill.
- Reconnect and repeated sync create one server bill.
- Two terminals never allocate the same receipt number.
- Cash and UPI totals follow different rounding rules online and offline.
- Price changes during an outage do not mutate completed offline bills.
- Expired authorization bundles block further offline billing.
- Local storage quota failure prevents checkout before a receipt is issued.
- Refund commands are unavailable offline.
- Synchronization failure is visible and recoverable.
