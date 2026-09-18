# Confirmed Platform Decisions

- Deliver Billing as an installable PWA for desktop, tablet, and mobile.
- Do not build a separate native Android application for the initial release.
- Continue using Supabase Auth and PostgreSQL.
- The two Next.js applications do not receive separate Supabase projects.
- POS and Admin share one Billing backend per environment.
- Use `jksh-billing-dev` for development and `jksh-billing-prod` for production.
- Separate concerns inside the project using `identity`, `billing`, `audit`, and
  `outbox` database schemas with explicit grants and API boundaries.
- Use `jksh-stock-dev` for Stock development and `jksh-stock-prod` for Stock
  production. Stock uses a separate Supabase project/database per environment and
  consumes versioned Billing events and never reads or writes Billing tables
  directly.
- `admin.jkshunited.com` provides combined Franchise Owner Billing/Stock
  navigation. The domains remain separate server modules with separate bounded
  database pools; a shared UI does not permit cross-database joins.
- Razorpay is limited to Franchise Owner payments for JKSH Stock orders. Store
  customer UPI remains externally verified through the outlet's bank scanner.
- Put identity, authorization, and Billing commands behind secure TypeScript API
  services; browser applications do not orchestrate privileged table mutations.
- Use `billing.jkshunited.com` for the Store PWA.
- Use `admin.jkshunited.com` for Central, Accountant, and Franchise Owner access.
- Expose versioned APIs behind a controlled API boundary; final DNS depends on
  the chosen deployment provider.
- JKSH is the parent organization.
- TVANAMM and T Leaf are brands under JKSH.
- TVANAMM is the first brand enabled for Billing.
- Each outlet has exactly one primary brand. A Franchise Owner may hold
  memberships for outlets across multiple JKSH brands through the same login.
- Brand and outlet configuration controls logo, display name, address, contact
  details, menu, pricing, receipt appearance, and enabled features.
- Core Billing behavior remains brand-neutral so T Leaf can be enabled without a
  second codebase.
- Generic Stock materials may be organization-shared across JKSH brands;
  branded powders, packaging, recipes, menus, and controlled items retain an
  explicit brand scope.
- `Ask JKSH AI` uses a provider-neutral gateway and authorized application tools;
  it never receives direct database authority or bypasses existing permissions.
- Gemini on Vertex AI is the initial production AI provider. Access is
  server-to-server through least-privilege Google Cloud identity; no Gemini
  credential is exposed to a browser.

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
