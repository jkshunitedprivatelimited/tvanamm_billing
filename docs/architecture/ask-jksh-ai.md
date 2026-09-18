# Ask JKSH AI — Platform Assistant

## Product Goal

`Ask JKSH AI` is a permission-aware assistant for Central Admin and Accountant,
plus a restricted read-only report/navigation assistant for Franchise Owners.
It can explain data, find records, produce insights, prepare drafts, and—for
authorized internal JKSH users—execute supported changes only through existing
application commands.

It is not a privileged database user, an autonomous accountant, or a replacement
for deterministic Billing/Stock calculations.

## User Experience

- A consistent `Ask JKSH` button opens a side panel on desktop and full-screen
  sheet on mobile/tablet.
- The assistant understands the current authorized page context: selected brand,
  outlet, date range, bill, Stock item, order, employee, or report.
- Suggested prompts are short and role-specific rather than a cluttered generic
  prompt wall.
- Answers use compact cards/tables and link to the supporting internal records.
- A command palette supports direct requests such as `Add a new tea`, `Show
  yesterday's unusual discounts`, or `Prepare an order from suggestions`.
- Conversation history is clearly scoped to the user/workspace and can be
  deleted by the user. User-visible history expires after 30 days; longer-lived
  domain/audit metadata follows its independent retention policy.

## Role Availability

- Central Admin: primary AI user with organization-wide questions, analysis,
  drafts, and confirmed mutations allowed by Central capabilities.
- Accountant: JKSH financial/audit analysis, navigation, reports, exports, and
  confirmed accounting/payment actions already allowed by Accountant
  capabilities.
- Franchise Owner: read-only questions, explanations, reports, and navigation
  scoped to owned outlets. AI mutation tools are not exposed.
- Store Employee, Warehouse Manager, and Warehouse Staff: no AI interface or AI
  API access.

## Supported Read Tasks

For enabled roles and subject to normal permissions, the assistant can:

- answer how-to questions about JKSH workflows and SOPs;
- find bills, refunds, expenses, shifts, attendance, menus, Stock movements,
  orders, invoices, suppliers, and audit events;
- summarize sales, best sellers, margin/cost-pending data, discounts, refunds,
  Cash variance, wastage, expiry, negative Stock, purchasing, fulfilment, and
  outlet comparisons;
- explain why a figure or status appears using linked source records;
- highlight suspicious patterns as review signals, never accusations;
- generate draft report filters and request authorized Excel exports;
- explain validation or synchronization failures and safe recovery steps.

Every factual answer states its outlet/brand/date scope and data freshness. When
evidence is missing or ambiguous, the assistant says so rather than inventing an
answer.

## Supported Change Tasks

Only Central Admin and Accountant may use change tools, and only for commands
already granted to that actor. The assistant may prepare and, after the required
confirmation, submit commands for:

- categories, menu items, add-ons, combos, outlet prices, availability, and
  scheduled offers;
- Central recipe drafts and SOP scaling calculations;
- employees, invitations, attendance corrections, and terminal/outlet settings
  within the actor's authority;
- Stock items, units, barcodes, suppliers, purchase-order drafts, counts,
  wastage, transfers, franchise-order carts, inward drafts, and return drafts;
- expense drafts, Cash movements, report/export requests, import mappings, and
  notification preferences.

The assistant never writes tables directly. It calls the same versioned command
services used by the UI, including validation, authorization, idempotency,
audit, and event publication.

## Risk and Confirmation Levels

### Level A — read/explain

Run immediately within scope. Examples: search, summarize, compare, explain.

### Level B — reversible draft

Show a concise proposed result, then create only after user confirmation.
Examples: product draft, purchase-order draft, report, import preview.

### Level C — operational or sensitive mutation

Require structured preview of exact fields/targets/financial or Stock effect,
explicit confirmation, and fresh authentication where existing policy requires
it. Examples: publish menu/price/offer, invite/disable employee, post inward,
Stock adjustment, supplier payment allocation, dispatch, or terminal change.

### Level D — prohibited autonomous behavior

The assistant cannot:

- bypass permissions, approval separation, fresh-auth, or tenant scope;
- silently create/complete a bill, refund, payment, dispatch, invoice payment,
  Stock adjustment, or employee access change;
- mark Cash/UPI/Razorpay/supplier payment successful without authoritative input;
- reveal or accept OTPs, PINs, passwords, tokens, keys, connection strings, or
  private cross-tenant data;
- delete/alter audit, completed financial records, or Stock ledger movements;
- execute arbitrary SQL, shell, HTTP requests, or unregistered tools;
- auto-order, auto-publish a recipe, or interpret an anomaly as proven fraud.

## Action Preview Contract

Before a mutation, the UI displays a deterministic preview generated by the
domain service—not prose invented by the model:

- action and target scope;
- create/update fields with before/after values;
- money, tax, Stock, availability, access, or publication effects;
- warnings, required evidence/reason, and approvals;
- idempotency key and expiry of the proposal.

The user's confirmation submits the signed proposal. If underlying data/version
changes, execution stops and requires a new preview. Bulk actions list every
target and never imply `all outlets` without explicit selection.

## Architecture

```text
UI -> AI Gateway -> intent/planning model
                -> authorized tool registry
                -> Billing/Identity/Stock read models and command APIs
                -> scoped knowledge retrieval
                -> audit/usage/quality telemetry
```

- AI Gateway derives identity and memberships from the session.
- Tools declare input/output schemas, required capabilities, risk level,
  idempotency behavior, maximum targets, and timeout.
- The gateway intersects model-requested scope with server-derived authorization.
- Billing and Stock remain separate databases/services; AI composes API results
  and never creates a cross-database join or distributed transaction.
- Long reports/imports run as background jobs and return progress links.
- Provider/model is replaceable behind one internal interface; core workflows do
  not depend on model-specific response text.

## Confirmed Gemini Deployment

- Gemini on Google Cloud Vertex AI is the initial production provider. The JKSH
  gateway remains provider-neutral so model changes do not alter domain commands,
  permissions, or audit contracts.
- Production authenticates server-to-server using a least-privilege Google Cloud
  service identity and short-lived credentials. Gemini credentials are never
  shipped to browsers or stored in Supabase/browser configuration.
- Use configurable, allowlisted, generally available model IDs: a fast low-cost
  model for help/extraction/routing and a stronger model only for complex
  analysis. Do not hard-code one preview model across the product.
- Use Gemini function calling for registered JKSH tools and JSON Schema structured
  output for UI cards. The JKSH gateway—not an automatic SDK loop—validates and
  authorizes every function call.
- Disable Gemini built-in Search, Maps, URL Context, Code Execution, and other
  external tools for operational requests. Ground only through scoped JKSH
  retrieval and application tools.
- Do not use stored Interactions, session resumption, explicit context caching,
  tuned models, or shared datasets until separately reviewed for retention and
  security.
- Use paid enterprise service terms and never opt JKSH prompts, responses, logs,
  feedback, or datasets into model improvement/training.
- Request/configure the strongest available zero-data-retention controls for the
  production project and verify them before enabling real business data.
  Provider-side retention and JKSH's own 30-day UI history are separate policies.

Official implementation references:

- [Vertex AI zero data retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/vertex-ai-zero-data-retention)
- [Gemini API zero data retention](https://ai.google.dev/gemini-api/docs/zdr)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

## Knowledge and Grounding

Retrieval sources include approved SOP versions, help documentation, role policy,
menu/recipe metadata, and authorized structured read models. Every chunk carries
organization/brand/outlet visibility, version, effective date, and provenance.

- Retrieval authorization occurs before content reaches the model.
- User-uploaded text and document content are untrusted data and cannot redefine
  system rules or tool permission.
- Structured financial/Stock answers come from deterministic queries or report
  services; the model explains their results.
- Responses cite internal source records/versions where the UI supports links.
- Old SOP/menu/recipe versions are labelled historical.

## Privacy and Security

- JKSH approved Gemini as the external cloud AI provider under the controlled
  deployment above.
- Minimize/redact phone numbers, customer details, bank references, employee
  personal data, and free-text reasons before model submission unless essential
  and explicitly permitted.
- Never send secrets, auth headers, cookies, OTP/PIN hashes, raw provider payloads,
  private receipt objects, or database credentials to the model.
- Use a provider configuration that contractually prevents training on JKSH data
  and offers suitable retention/residency controls.
- Encrypt stored conversations and tool results; tenant-scope every row and
  object.
- Apply prompt-injection/content-isolation defenses to SOPs, imports, attachments,
  and retrieved text.
- Rate-limit per user/organization, bound input/output/tool counts, and prevent
  recursive agent loops.

## Audit

Record conversation/action ID, actor/session, scope, model/provider/version,
policy version, tool name, proposal/result hashes, confirmation/fresh-auth event,
latency, token/cost class, and outcome. Store user-visible redacted
prompts/responses for 30 days, then delete them; retain only policy-approved
action/audit metadata for the applicable audit period. Domain audit remains
authoritative for changes.

The audit view can reconstruct who requested, previewed, confirmed, executed, or
denied an AI-assisted change without storing secrets or hidden reasoning.

## Cost and Performance

- Do not call AI automatically on every page load.
- Use deterministic search/calculation for simple requests and AI only when it
  adds interpretation or natural-language value.
- Route simple help/extraction to a lower-cost model and complex planning to a
  stronger model within configured budgets.
- Query summary/read models instead of sending raw bills or ledgers.
- Cache only safe versioned knowledge answers; never share tenant-specific answer
  caches across organizations.
- Stream visible responses, cap context/history, summarize older conversation,
  batch tool reads, and cancel abandoned requests.
- Central configures daily/monthly AI budgets and alerts; hitting a budget fails
  gracefully without affecting Billing or Stock.

## Failure Behavior

- AI outage hides/disables assistant actions but never blocks normal UI workflows.
- Tool timeout leaves the proposal unexecuted unless the domain API confirms an
  idempotent result.
- Unknown execution state is reconciled by idempotency key before retry.
- Unsafe, ambiguous, over-broad, cross-tenant, or unsupported requests are denied
  with the normal manual navigation path.
- Model text can never be treated as proof that a mutation or payment succeeded.

## Evaluation and Release Gates

- permission and cross-tenant exfiltration tests for every tool;
- prompt-injection and malicious-document evaluations;
- correct refusal for prohibited actions/secrets;
- grounded-answer and citation accuracy sets across Billing/Stock/SOP questions;
- action-preview, stale-version, confirmation, fresh-auth, and idempotency tests;
- financial/Stock results match deterministic services exactly;
- UI accessibility, mobile layout, cancellation, timeout, and fallback tests;
- latency, token, cost, rate-limit, and concurrency budgets;
- human acceptance tests for Central, Accountant, and Franchise Owner;
- explicit denial tests for Store Employee, Warehouse Manager, and Warehouse
  Staff.

Start with read-only tools in a non-production environment. Enable each mutation
tool separately only after its authorization, preview, audit, rollback/reversal,
and adversarial tests pass.
