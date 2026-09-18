# Six-Month Functional Stability Plan

## Goal

Deliver a complete production baseline that should operate for at least six
months without planned feature redesign. This does not mean skipping security
patches, dependency maintenance, backups, monitoring, bug fixes, statutory
changes, or provider API updates.

## Included Baseline

- identity, tenancy, invitations, OTP, terminal enrollment, PIN, and permissions;
- outlet/menu/tax/add-on/combo management and controlled publication;
- online/offline Billing, shifts, Cash, receipts, history, refunds, reports,
  export, and archive;
- complete Stock operations and franchise Stock commerce with Razorpay;
- recipes, SOP scaling/costing, prepared bases, and Billing events;
- combined Franchise Owner dashboard;
- lightweight attendance and activity reporting, excluding payroll;
- consistent design system, responsive screens, accessibility, and performance.
- safe Excel imports and in-app operational notifications.
- outlet operational expenses and scheduled offers.
- Cash top-up/drop/deposit control and supplier invoice/payment tracking.
- supplier returns, scanning, label printing, and multiple held POS carts.
- permission-aware `Ask JKSH AI` for grounded answers, insights, drafts, and
  explicitly confirmed application changes.
- Gemini on Vertex AI through a provider-neutral, server-only gateway with
  controlled retention and no-training configuration.

Explicitly excluded are loyalty/CRM, franchise royalty/fee accounting,
payroll/HRMS, product variants, Swiggy/Zomato integration, and direct customer
ordering.

## Stability Rules

- Version APIs, events, recipes, menus, receipt templates, and exports.
- Use additive forward migrations and expand/migrate/contract deployment.
- Keep providers behind adapters and risky integrations behind per-outlet flags.
- Preserve immutable financial/inventory history.
- Provide idempotency, inbox/outbox delivery, reconciliation, and recovery tools.
- Require tenant isolation, least privilege, secret rotation, audit, backups,
  restore drills, observability, capacity alerts, and automated release gates.

Configuration, menu, price, recipe, outlet, employee, material, and channel-map
changes use normal versioned workflows. Security fixes, compatible provider
updates, bug fixes, and measured performance work continue during the six months.
Financial-rule changes, new authority, new payment modes, automatic ordering,
variants, payroll, loyalty, or fee accounting require a separately approved
roadmap change.

Implementation is complete only when every stage maps to migrations, commits,
tests, security review, configuration, monitoring, recovery, and a named owner.
