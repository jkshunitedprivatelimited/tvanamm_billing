# Stock release review 10 October 2026

Stock is not ready for a complete business release. Core inventory services exist
and automated tests cover many workflows, but operating screens, SOP publication,
opening balances and hosted event processing still have release gates. Live
Billing remains in service throughout this work.

## Read only environment checks

Both documented deployed health URLs returned HTTP 200 with `status: ok`:
`https://tvanamm-admin.vercel.app/api/v1/health` and
`https://tvanamm-billing-pi.vercel.app/api/v1/health`.
This confirms database reachability; it does not verify the cashier/printer flow.

The locally configured shared databases were inspected in `BEGIN READ ONLY`
transactions, with a three-second statement timeout. Their configuration has
localhost application URLs, so these counts describe the configured databases;
the deployment/database association still needs verification.

| Configured database check                                       | Observed value |
| --------------------------------------------------------------- | -------------- |
| Chef workbook menu items                                        | 128            |
| Saved SOP entries                                               | 104            |
| Entries marked ready                                            | 55             |
| Saved drafts that do not pass ready validation                  | 49             |
| Workbook items without a saved SOP                              | 24             |
| Active outlet-created item records outside the central workbook | 43             |
| Active catalog items with a Stock recipe link                   | 0              |
| Submitted workbooks                                             | 0              |
| Latest saved SOP change                                         | 2 October 2026 |
| Pending Billing sale/refund events                              | 345            |
| Stock configured outlets                                        | 9              |
| Outlets with tracking enabled                                   | 2              |
| Active Stock material items                                     | 3              |
| Configured low-stock alert limits                               | 0              |
| Recorded low-stock notifications                                | 0              |
| Stock recipes, including historical/archived records            | 2              |
| Published version records                                       | 4              |
| Pending Stock inbox events                                      | 2              |
| Dead-lettered Stock inbox events                                | 0              |
| Stock master flag                                               | Enabled        |
| Live Razorpay flag                                              | Disabled       |

No production migration, seed, event replay, worker activation, menu publication,
recipe publication, stock movement, payment or deployment was performed.

Follow-up read-only checks on 10 October at 16:27 IST confirmed that all 128 active
master catalog items are represented in the central workbook. All 55 ready SOPs
pass the current form schema; none of the 49 saved drafts passes ready validation.
That validates required fields, not the chef's physical measurements or Stock
ingredient mapping. The 43 active outlet-created catalog records require a
separate coverage review and may reuse approved SOPs where appropriate.
The workbook remains open and unsubmitted. Zero configured low-stock rules means
the current setup cannot generate low-stock alerts for its materials.

The next work sequence, reminder requirements and item-by-item outstanding SOP
lists are in [Stock completion plan](stock-completion-plan-2026-10-10.md).

## Corrections prepared locally

- Add-on consumption multiplies the add-on quantity by the sold menu quantity.
- Prepared-base consumption retains per-serving packaging deduction, locks batch
  quantities against concurrent sales, and can use multiple eligible batches.
  Quarantined, recalled and expired named batches are excluded.
- Default optional ingredients are consumed; unselected optional rows are skipped.
- Movement idempotency identifies the menu/add-on and recipe-component row,
  preventing overlapping ingredients from suppressing each other's deductions.
- Concurrent ingestion and sale/refund replay serialize on the immutable event ID.
- Billing outbox delivery claims rows, respects retry schedules, records failed
  attempts, dead-letters at the cap and continues past an unsupported event.
- Central can review and explicitly requeue a failed Billing transfer within its
  organization; retry preserves the original event and bill.
- Stock inbox retries use bounded exponential delays and serialize worker cycles.
  Explicit dead-letter recovery resets the retry schedule.
- `npm run stock:events` provides a bounded recurring worker and `--once` scheduler
  mode. It requires a signing secret in production and honors `stock.enabled`.
  Adding a command does not install a hosted scheduler.
- Central can prepare a Stock draft from one reviewed, ready chef SOP revision.
  The source snapshot is saved and retries reuse it without overwriting recipes.
  Ingredient mapping is explicit; changed base units require a verified converted
  quantity. Packaging is added separately. Publication and Billing menu changes
  remain separate reviewed actions.
- Mapped recipe-version drafts persist separately from chef/AI source snapshots.
  Saves and publication check draft revision and current published version;
  concurrent edits fail visibly instead of overwriting another review.
- The dependency audit identified one critical and two high-severity production
  dependency findings. Both apps and their lint plugin now require Next.js
  `~16.3.8`; the lockfile also updates sharp to `0.35.5` and source-map-js to
  `1.2.2`. These changes were installed and tested only in the isolated checkout.

Stock migrations `0017_inbox_retry_backoff.sql` and `0018_recipe_editor_drafts.sql`
are additive and required by the new processor/editor. They must precede
deploying or starting those components. There is no
Billing schema migration in this change.

## Remaining software work

| Area                           | Current implementation and release requirement                                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner Stock portal             | `apps/admin-web/src/app/(app)/stock/layout.tsx` intentionally replaces owner child pages with Expenses & wastage and a Coming soon notice. Existing inventory/order pages therefore are not a complete released owner workflow. Add an explicit outlet-scoped rollout gate and verify owner navigation before exposing them. |
| Warehouse operations           | Production, internal transfers and supplier-return services/routes exist, but the current Stock operations navigation has no complete operational screens for these flows. Build and exercise the enabled warehouse paths and role-specific navigation.                                                                      |
| Stock offline                  | Server drafts support local inward/wastage; count and receiving kinds are explicitly not auto-applied. A complete durable browser queue, synchronization and recovery flow is still required before claiming offline Stock support.                                                                                          |
| Recipe authoring               | Chef snapshots and saved mapped-version drafts persist with revision checks. Review the mapped ingredients and packaging before publication; recipe/menu publication still requires explicit business actions.                                                                                                               |
| Prepared bases                 | Consumption exists, but no application service currently records new prepared batches; tests insert those fixtures directly. Add measured preparation posting and a staff screen before enabling this path for business use.                                                                                                 |
| Refund reporting               | The current consumer records `refund_noop` and never restores ingredients. Prepared cancellation/wastage reporting still needs to meet the published reporting contract.                                                                                                                                                     |
| Cross-system result processing | Stock emits result/recipe/availability events. A complete downstream consumer and meaningful end-to-end reconciliation must be verified; current reconciliation mainly counts queues.                                                                                                                                        |
| Delivery operations            | Install and supervise event and low-stock workers in the verified deployment environment; monitor lag, retry failures and dead letters.                                                                                                                                                                                      |
| Payments                       | Live payment remains disabled. Provider test callback/webhook/refund evidence is required if supply ordering is part of the pilot.                                                                                                                                                                                           |

## Business and deployment gates

1. The user selected named test outlets first. `TEST Stock Outlet 1` and
   `TEST Stock Outlet 2` exist only in the disposable local databases; their
   simulated sale-event trial deducts 200 ml from the first outlet, leaves the
   second unchanged and preserves both balances on replay. This is a backend
   event trial, not an actual device/printer or live Billing transaction.
   Select one real pilot outlet and its enabled scope after the test phase. The existing live Billing outlets
   remain on their working configuration until the pilot reconciles.
2. Review the 55 entries marked ready, finish the remaining 73 items or explicitly
   restrict the recipe-tracked menu, and resolve missing quantities/alternatives.
3. Map verified stock ingredients and packaging, publish immutable recipe versions,
   and explicitly publish only the selected outlet's menu mapping.
4. Enter physical opening quantities through supported documents. Do not infer
   opening stock from historical bills or populate fictitious balances.
5. Verify the exact deployed database projects, migration drift, backup/restore
   point, rollout flags, worker credentials and rollback artifact.
6. Inspect queued-event age/recipe versions/tracking start times before replay.
   Keep the 345-event queue unchanged until the treatment of pre-activation sales
   is reviewed; never apply today's recipe version to historical snapshots.
7. Rehearse receiving, local purchase, counts, wastage, sale/add-on deduction,
   refund, alerts and recovery in staging with actual device/printer checks.
8. Release only the passing pilot scope, reconcile one complete business day,
   then expand outlet by outlet.

## Validation

The unmodified committed baseline passed 407 tests across 64 suites in a clean
checkout against two disposable PostgreSQL databases on localhost port 55432.
The original workspace dependencies produced module/JSON loading errors, so
validation uses freshly installed lockfile dependencies in an isolated copy.
Final source verification passed 418 tests across 66 suites, workspace
TypeScript checks, scripts TypeScript checks, lint, changed-code formatting and
both production application builds. The event worker's `--once` run correctly
reported `disabled: true` against the isolated Stock database and exited cleanly.

The user explicitly approved the dependency audit. After the updates,
`npm audit --omit=dev --audit-level=high` reports **0 vulnerabilities**.
The full audit still reports four high-severity entries along the development-only
`@next/eslint-plugin-next -> fast-glob -> micromatch -> braces` dependency chain.
The [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
lists no patched version. npm's proposed forced fix downgrades the Next.js lint
plugin to an older major release; that incompatible downgrade was not applied.
This is an unresolved development-tool finding, not a clean full dependency audit.
Production dependency corrections address the
[Next.js advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j),
[sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) and
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

No real-device printer rehearsal, live cashier checkout, physical-count
reconciliation, hosted worker installation or deployment is represented as
complete. The source changes remain local and the two additive Stock migrations
have only been applied to disposable test databases.
