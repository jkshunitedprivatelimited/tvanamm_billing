# Confirmed Platform Decisions

- Deliver Billing as an installable PWA for desktop, tablet, and mobile.
- Do not build a separate native Android application for the initial release.
- Continue using Supabase Auth and PostgreSQL.
- The two Next.js applications do not receive separate Supabase projects.
- POS and Admin share one Billing backend per environment.
- Use `jksh-billing-dev` for development and `jksh-billing-prod` for production.
- Separate concerns inside the project using `identity`, `billing`, `audit`, and
  `outbox` database schemas with explicit grants and API boundaries.
- When Stock development begins, create a separate Stock Supabase project if
  physical isolation is required. Stock consumes versioned Billing events and
  never reads or writes Billing tables directly.
- Put identity, authorization, and Billing commands behind secure TypeScript API
  services; browser applications do not orchestrate privileged table mutations.
- Use `billing.jkshunited.com` for the Store PWA.
- Use `admin.jkshunited.com` for Central, Accountant, and Franchise Owner access.
- Expose versioned APIs behind a controlled API boundary; final DNS depends on
  the chosen deployment provider.
- JKSH is the parent organization.
- TVANAMM and T Leaf are brands under JKSH.
- TVANAMM is the first brand enabled for Billing.
- Brand and outlet configuration controls logo, display name, address, contact
  details, menu, pricing, receipt appearance, and enabled features.
- Core Billing behavior remains brand-neutral so T Leaf can be enabled without a
  second codebase.

## Confirmed Request and Load Optimization

- Deploy POS and Admin independently so Store devices do not download Admin code.
- Build POS as a lightweight offline-capable PWA shell.
- POS calls Billing API directly; avoid unnecessary gateway/service hops.
- Billing API validates signed session tokens locally and does not call Identity
  API for every Billing request.
- Identity API handles login, PIN validation, session refresh/revocation,
  membership changes, and logout.
- Cache versioned branding, menu, pricing, and outlet configuration.
- Do not publicly cache tenant financial records.
- Use server-side pagination, indexed queries, compact API models, and background
  jobs for exports, reports, notifications, and archival.
- Co-locate APIs and database in the nearest suitable deployment region.
- Prefer autoscaling/serverless deployment initially to limit idle cost.

## Required Sections in Future Plans

Every feature plan must cover:

1. User workflow and permissions.
2. Application and API boundaries.
3. Database ownership and migrations.
4. Authentication and tenant isolation.
5. Online and offline behavior.
6. Performance and server-load impact.
7. Caching and data-retention behavior.
8. Failure handling, retries, and idempotency.
9. Audit, monitoring, and notifications.
10. Automated tests and release acceptance criteria.
