# Outlet Onboarding and Ownership Plan

## Confirmed Ownership Model

- JKSH is the parent organization.
- TVANAMM and T Leaf are brands under JKSH.
- Billing is enabled for TVANAMM first.
- An outlet is either `jksh_owned` or `franchise_owned`.
- Every outlet has exactly one immutable primary brand after creation. Changing
  primary brand requires a controlled migration/new outlet rather than rewriting
  historical bills, receipts, menus, recipes, or Stock scope.
- JKSH/Central has its own operational outlet in addition to customer franchise
  outlets.
- Only Central Admin can create an outlet.
- Franchise Owners can own and access multiple assigned outlets but cannot create
  them.
- One owner account may hold outlet memberships across multiple JKSH brands; each
  outlet card shows its brand clearly.
- Accountant has financial access across every JKSH-owned and franchise-owned
  outlet.
- JKSH-owned outlet employees use the same Store Employee ID, four-digit PIN,
  registered-terminal, and shift flows as franchise-owned outlets.

## Outlet Access Lifecycle

- Central Admin controls `active`, `suspended`, and `closed` outlet access states.
- Suspending an outlet immediately blocks new online Billing operations and
  revokes its active terminal authorization.
- Offline authorization stops on the next server contact or at its 24-hour
  expiry, whichever happens first.
- Franchise Owner retains read/export access to existing financial records unless
  Central explicitly removes that membership for a documented reason.
- Central Admin can restore access through an audited reactivation flow.
- Closing an outlet never deletes financial history or bypasses the normal
  export, archive, and retention policy.

## Outlet Creation

Central Admin creates an outlet with:

- brand;
- ownership type;
- outlet display name;
- legal/business name when different;
- primary mobile number;
- address and locality;
- city, state, postal code, and country;
- IANA timezone, defaulting to `Asia/Kolkata`;
- GSTIN, optional;
- receipt contact/details, optional;
- assigned Franchise Owner for franchise-owned outlets;
- Billing activation state;
- initial menu/pricing configuration;
- Cash/UPI payment availability;
- data-retention and notification defaults.

The system generates stable organization, brand, franchise, and outlet IDs. Names
are display data and never act as database relationships.

## Outlet Lifecycle

```text
draft -> active -> suspended -> active
                        -> closed
```

- Draft outlets cannot bill.
- Active outlets can register a terminal and bill.
- Suspended outlets retain data but cannot create new bills.
- Closed outlets retain financial and audit records according to retention rules.
- Outlet records with financial history are never hard-deleted.
- Ownership transfer, if later permitted, must be an audited workflow rather than
  editing IDs on existing bills.

## Terminal Policy

- One active Billing terminal per outlet for MVP.
- Franchise Owner performs first registration after Central activates the outlet.
- JKSH-owned outlet registration is performed by an authorized Central Admin.
- Terminal replacement revokes the old credential before activating the new one.
- Unsynchronized offline bills must be recovered/synchronized before replacement
  completes, unless Central uses an audited emergency recovery process.
- Schema and contracts support multiple terminal records for future expansion.

## Access

- Central Admin: manage every outlet; cannot create customer bills.
- Accountant: all-outlet financial access and audited adjustments; no outlet/user
  administration.
- Franchise Owner: manage assigned outlets and switch through outlet cards.
- Store Employee: operate Billing only for their single assigned outlet.

## Required Tests

- Franchise Owner cannot create an outlet.
- Franchise Owner cannot assign themselves another outlet.
- Owner sees only assigned outlet cards.
- Accountant sees reports for JKSH-owned and franchise-owned outlets.
- Store Employee cannot access another outlet.
- Only one active terminal can exist per outlet in MVP.
- Replacement revokes the prior terminal and preserves pending-bill safety.
- Missing GSTIN does not block outlet activation.
- Suspended/closed outlet cannot create new bills.
