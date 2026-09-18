# JKSH Product UI/UX Design System

## Experience Goal

The product should feel calm, premium, fast, and obvious during a busy outlet
shift. Attractive means strong hierarchy, balanced spacing, clear typography,
useful motion, and brand warmth—not decorative clutter.

The same design language covers:

- Store POS PWA;
- Central and Accountant Admin;
- Franchise Owner Billing/Stock portal;
- warehouse and Stock operations;
- reports, recipes, and attendance.
- the global `Ask JKSH AI` side panel and structured action previews.

Each role sees only relevant navigation and actions. Responsive layout changes
presentation, never authorization.

## Visual Direction

- Use a warm tea/cafe palette derived from approved TVANAMM assets: deep leaf
  green or tea brown as primary, warm cream surfaces, restrained amber accents,
  and neutral ink text.
- Keep financial, warning, success, and destructive colors semantic and
  accessible; brand colors never replace error meaning.
- Use one modern high-legibility sans-serif family with tabular numerals for
  prices, quantities, reports, and receipt sequences.
- Use an 8-point spacing system, generous page gutters, consistent radii, subtle
  borders, and restrained shadows.
- Prefer real product photography or clean approved illustrations. Never fill
  operational screens with decorative graphics.
- Support light theme first and tokenized dark theme later without rewriting
  components.

Final color tokens and logo treatment are approved against the actual brand
files before production; temporary colors are never shipped as the brand.

## Density and Hierarchy

- One clear page title, one primary action, and at most two secondary actions in
  the page header.
- Keep rare/destructive actions in a labelled overflow menu or detail panel.
- Use cards only for distinct summaries or navigation—not as a wrapper around
  every field.
- Use tables for comparison and scanning; use cards for outlet/mobile summaries.
- Progressive disclosure: overview first, drill-down second, advanced filters in
  a drawer.
- Default forms show essential fields; optional/legal/advanced fields appear in
  clearly named sections.
- Never present raw UUIDs, schema names, event IDs, or technical error payloads
  to normal users.

## Navigation

### Store POS

Full-screen task layout with no Admin sidebar:

```text
top status: outlet | employee | online/offline | shift | sync
main: categories + searchable product grid | sticky cart
footer/action: hold/clear | discount | Cash | UPI
```

Products have large touch targets, concise names, price, image when useful, and
visible availability. Cart total and payment action never scroll out of reach on
desktop/tablet. Mobile uses a bottom-sheet cart and persistent cart-total button.
Held carts use one visible badge/list with generated label, age, item count,
amount, and creator—not many permanent tabs cluttering the POS.

### Admin and Franchise Owner

- Desktop: compact collapsible left navigation and top context bar.
- Tablet: icon rail plus labelled expansion.
- Mobile: bottom navigation for the four most-used destinations plus `More`.
- Franchise Owner lands on combined outlet cards, then drills into an outlet.
- Switching outlets is always visible and requires no logout.
- Billing and Stock panels load independently so failure in one does not blank
  the other.

Recommended top-level owner navigation:

```text
Overview | Billing | Inventory | Order Stock | Reports | Employees | More
```

Central additionally receives Brands, Franchises, Outlets, Warehouse, Recipes,
Audit, and Settings. Accountant sees financial/reporting areas only.

For Central and Accountant, `Ask JKSH` remains one consistent header action
instead of adding separate chat pages inside every module. Franchise Owner sees
the same entry for read-only report explanation/navigation. Store and Warehouse
employees never see it. The panel preserves selected role/brand/outlet/page
context and never covers confirmation details for a high-impact internal action.

## Core Screen Contracts

### Dashboard

- Show 4–6 decision-useful KPIs, not a wall of numbers.
- Use period and outlet context once at the top, shared by every card.
- Owner overview prioritizes sales, Cash/UPI, refunds/discounts, low/negative
  stock, pending inward, Stock orders, and exceptions.
- Central overview adds cross-outlet comparison, best sellers, purchase
  compliance, suspicious exceptions, fulfilment, expiry, and sync health.
- Every metric links to its filtered evidence; avoid unexplained scores.

### Lists and reports

- Sticky search/filter row, meaningful default sort, pagination, saved URL state,
  empty state, and export action.
- Desktop uses aligned tables; mobile turns each row into a compact summary with
  tap-to-detail.
- Currency and quantities align right using tabular numbers.
- Status uses text plus color/icon; never color alone.
- Destructive and financial mutations never occur by clicking a row.

### Forms

- Labels stay visible above fields; placeholders are examples, not labels.
- Validate near the field and preserve entered values after recoverable errors.
- Use searchable selectors for franchise/outlet/item; never request raw IDs.
- Show GST-inclusive price and calculated taxable/GST values before save.
- Draft, Preview, and Publish remain separate visible steps for menu changes.
- Long workflows use a short stepper with save/resume and a final summary.

### Inventory and Stock ordering

- Inventory screen leads with search, stock state, usable/on-hand/inbound,
  expiry, and last movement.
- Movement detail uses an immutable timeline with source document links.
- `Order Stock` separates suggested, catalog, cart, payment, dispatch, and inward
  states.
- Suggestions explain why and remain editable; no dark-pattern auto-selection.
- Razorpay screen shows authoritative order total before leaving the app and a
  clear verifying/pending/paid/failed state on return.

## Interaction Rules

- Minimum touch target 44×44 CSS pixels; POS primary targets should be larger.
- Show immediate pressed/loading feedback and disable duplicate submission.
- Use optimistic UI only for reversible, low-risk changes. Bills, refunds,
  payment verification, Stock movements, and publication wait for authoritative
  confirmation.
- Confirm destructive/high-impact actions with a concise consequence summary;
  require reasons only where the business/audit policy requires them.
- Toasts confirm minor outcomes. Persistent banners/cards communicate offline,
  sync, payment, migration, or reconciliation problems.
- Never hide failure in a disappearing toast.
- Motion is short and functional; respect reduced-motion preferences.

## Complete State Design

Every screen/component designs these states before it is considered complete:

- first load and skeleton;
- empty/new account;
- populated;
- searching/filtering with no results;
- validation failure;
- permission denied;
- partial service failure;
- offline/cached/stale;
- saving/synchronizing;
- success;
- retryable failure;
- terminal/action-required failure.

Dates show outlet timezone. Cached data shows its last synchronized time. Money,
quantity, status, and audit information never disappear merely because an image
or secondary API failed.

## Accessibility and Language

- Meet WCAG 2.2 AA for contrast, keyboard access, focus, labels, errors, and
  screen-reader semantics.
- Do not use icon-only critical actions without an accessible label/tooltip.
- Support 200% zoom and responsive reflow without clipped financial values.
- Use plain action language: `Create bill`, `Mark out of stock`, `Record inward`,
  `Refund selected items`.
- Build copy through centralized message keys so Telugu and additional languages
  can be introduced without component rewrites. English is the confirmed initial
  product language; Telugu remains a later configuration, not a redesign.

## Performance and Server Cost

- Split POS, dashboards, Stock, reports, recipes, and attendance bundles.
- Load route data in parallel and independently; render useful sections without
  waiting for the slowest card.
- Paginate server-side and virtualize only genuinely large lists.
- Cache immutable branding/menu/version assets; never publicly cache tenant
  financial data.
- Serve responsive compressed images with fixed dimensions to prevent layout
  shift.
- Avoid polling dashboards continuously. Use refresh-on-focus, bounded intervals
  for live queues, and event-driven invalidation where justified.
- Set measurable budgets for initial JavaScript, largest-content paint, API
  latency, layout shift, and interaction response on the actual outlet device.

## Design Governance and Acceptance

- Maintain design tokens and shared accessible primitives in one UI package.
- Create a component gallery for buttons, fields, dialogs, tables, cards, status,
  money, quantity, receipt, offline, and error states.
- Review each feature at mobile, tablet POS, laptop, and wide desktop sizes.
- Use realistic long item/outlet names and large values—not only ideal seed data.
- Require keyboard, screen-reader, contrast, visual-regression, responsive, and
  low-powered-device checks.
- Conduct task tests with a Central user, Franchise Owner, and Store Employee.
- A screen fails UX acceptance if users must remember codes, navigate duplicate
  modules, lose context, cannot recover an error, or cannot identify the primary
  action quickly.
