# Stock completion plan — 10 October 2026

This is the sequence for finishing and releasing Stock. It records the current
read-only findings and proposed work; it does not enable workers, publish recipes,
change live Billing, or activate outlets. Start with TEST Stock Outlet 1 and
TEST Stock Outlet 2 in isolated databases, as requested.

## Verified current state

Checked the locally configured shared Billing and Stock databases at 16:27 IST
using read-only transactions and a three-second query timeout. The exact
association with deployed application projects remains unverified.

| Check                                                   | Result                                |
| ------------------------------------------------------- | ------------------------------------- |
| Active master menu records                              | 128                                   |
| Master items present in central SOP workbook            | 128, no missing master items          |
| SOPs marked ready and passing required-field validation | 55                                    |
| Saved draft SOPs                                        | 49; none passes ready validation      |
| Workbook items with no saved SOP                        | 24                                    |
| Active outlet-created catalog records                   | 43; separate coverage review required |
| Active catalog records with Stock recipe links          | 0                                     |
| Workbook submission                                     | Not submitted; link remains open      |
| Most recent saved SOP update                            | 2 October 2026                        |
| Active Stock material records                           | 3                                     |
| Stock configured outlets / tracking enabled             | 9 / 2                                 |
| Configured low-stock limits                             | 0                                     |
| Low-stock notification records                          | 0                                     |
| Live supply-order payment flag                          | Disabled                              |

A form-valid SOP is not a verified physical recipe or a published Stock recipe.
The 43 outlet-created records are not necessarily 43 distinct recipes: review
whether each needs its own SOP or can reuse an approved one. The workbook is a
master-menu snapshot; add-on and combo consumption must also be audited rather
than inferred from this item count.

## What automatic reminders currently do

Existing code supports per-item, per-outlet minimum quantities, conversion from
compatible units, and an alert when usable stock is at or below the limit.
Usable stock is sellable on-hand minus reserved stock; expired, quarantined and
recalled named batches are excluded. Uncounted materials do not generate a low
alert. A shortage creates one episode; replenishment above the minimum resolves
it; a later shortage opens a new episode. Notification delivery deduplicates
replays and scopes notices to Central and the relevant franchise owner.

The worker checks every 30 seconds when running, and the visible browser bell
polls every 30 seconds. These intervals are not proof of a hosted running job or
a guaranteed notification latency. Offline bills affect stock only after sync and
event processing. The existing operational channel is in-app; SMS is currently
used for login OTP, not low-stock reminders.

Gaps to fix or verify:

- No configured limits means no automatic low-stock episodes for the current setup.
- A durable hosted worker and restart supervision have not been verified.
- The alert worker does not check the Stock master flag before scanning/delivery;
  add safe pause and explicit pilot scope handling.
- Failed delivery stays pending without persisted attempts, delayed retries or a
  dead-letter workflow. A full first batch of failing events can hold up later
  rules. Preserve ordering for each rule while allowing unrelated rules through.
- There is no persisted worker heartbeat or last-success/lag visibility sufficient
  to tell users whether the system is healthy, delayed, or stopped.
- The current system has no scheduled repeat reminder while the same shortage
  remains unresolved. Propose configurable daily in-app follow-ups, grouped by
  outlet, with deduplication, mute handling and immediate stop after recovery.
- Owner Stock child pages are replaced by the current Expenses & wastage /
  Coming soon layout, so an owner notification cannot yet reach the intended
  working stock page. Introduce outlet-scoped access and verify every link.

## Work sequence and completion checks

1. **Isolate the trial and confirm environment boundaries.** Prepare test-only owner/staff access, preserve Billing behavior, verify separate databases and the exact deployed project mapping. Add an explicit outlet rollout gate with other outlets off.

   **Done when:** Both named test outlets work; a URL or API change cannot reach another outlet; Billing stays usable when Stock is unavailable. No shared queue is replayed.

2. **Complete SOP coverage.** Finish 49 drafts and 24 missing entries; review the 55 ready entries; check the 43 outlet-created records, add-ons, combos, serving variants and prepacked items. Keep the original chef snapshots and revision history.

   **Done when:** Every item in the selected Stock-tracked scope has an approved measured SOP or an explicit reviewed exclusion. No guessed ingredient quantities and no automatic recipe publication.

3. **Build verified material and recipe mappings.** Complete raw materials, packaging, prepared products, units, conversions, item supply rules and batch requirements. Map SOPs to immutable recipe versions and selected menu snapshots. Check decimal precision and serving/add-on quantities.

   **Done when:** Representative bills consume the correct measured ingredient/packaging quantities once. Repeated requests and historical bills retain their original recipe version.

4. **Finish daily outlet workflows.** Expose the pilot owner's overview, stock balances, opening count, receiving, local purchases, counts, wastage, discrepancies and returns. Verify staff entry/review permissions and approved corrections.

   **Done when:** Physical counts reconcile with immutable movements. Cross-franchise access fails. Staff cannot approve restricted adjustments. Counts and purchases remain reviewable after retry.

5. **Complete preparation, warehouse and integration flows.** Add measured prepared-batch posting and its screen; complete warehouse production, transfers and supplier-return screens/navigation. Verify downstream Stock result processing, refund/cancellation reporting and meaningful reconciliation.

   **Done when:** Preparation followed by sale cannot consume raw inputs twice; prepared-sale refunds do not invent restored ingredients; ledger/balance reconciliation and role checks pass.

6. **Make event processing operational.** Validate the local event-worker changes, deploy additive migrations before dependent code in staging, supervise bounded delivery/consumption jobs, add job status, alerting and controlled replay procedures.

   **Done when:** Crash/retry/concurrent worker trials cause no double deduction; unsupported events do not stall valid events; backlog age and dead letters are visible. Review historical recipe/tracking dates before any shared replay.

7. **Finish automatic low-stock reminders.** Configure business-approved per-outlet minima after physical starting counts. Add flag/pilot gates, delivery backoff and recovery, heartbeat/lag status, owner action links and optional scheduled daily follow-ups.

   **Done when:** A threshold crossing reaches only the correct owner and Central; replay does not duplicate it; repeated scans do not flood the inbox; replenishment ends the episode and follow-ups; expiry and reserved stock are handled correctly.

8. **Complete offline behavior and recovery.** Build a durable browser queue for the supported Stock actions, explicit sync status, duplicate-safe recovery and conflicts. Count/receiving actions must use their authorized document flows; do not blindly apply saved payloads.

   **Done when:** Refresh, offline/online transitions and lost acknowledgements preserve entries and cannot double-post movements or expenses. Unsupported offline actions are clearly explained.

9. **Verify ordering and finance separately.** Exercise catalogue, packs/prices/tax, supply orders, partial dispatch/inward, backorders, returns, credits, invoices and accountant access. Complete provider test callbacks/webhooks/refunds if payments are included.

   **Done when:** Order totals and stock documents reconcile; dispatch cannot bypass verified payment where required; duplicate callbacks cannot create duplicate transactions. Live payments remain disabled until this passes.

10. **Rehearse and release in stages.** Run full regression/build checks and browser/device/printer exercises on the test outlets. Verify environment, migrations, rollback artifact and job monitoring. Enter measured opening quantities for one chosen real pilot shop.

**Done when:** One full business day reconciles sales, stock, purchases, wastage and alerts. Release the passing scope to that shop, then expand outlet by outlet.

Recipe data and screens can be completed while hosted jobs are prepared, but do
not activate automatic reminders on shared outlets before the starting counts,
limits, recipe mappings and owner action pages are verified. Hardware/printer
checks must be done on an actual device; passing backend tests alone cannot
establish that result.

## Reminder acceptance scenarios

1. Start above the configured minimum: no low notice.
2. Post a sale that reaches the minimum: one correctly scoped low notice.
3. Scan repeatedly and replay delivery: one episode, no duplicate notice.
4. Replenish above the minimum: resolve the episode and stop follow-ups.
5. Drop below the minimum again: a new episode, not a stale reopened notice.
6. Exercise zero minimum, fractional units, kg/litre conversions, reservations,
   expiry, quarantine/recall, disabled rules and uncounted materials.
7. Break notification delivery, restart the worker and simulate a lost acknowledgement:
   preserve per-rule order, recover without duplicates, and keep healthy rules moving.
8. Disable the pilot/master gate: prevent new work for that scope and show the
   paused state; define how already queued resolution events are handled.
9. An owner can open the linked pilot outlet and cannot read another franchise.
10. If daily follow-ups are enabled, send at most the configured daily notice for
    the unresolved episode; honor mute preferences and suppress recovered episodes.

The [missing items review](stock-missing-items-review-2026-10-10.md) now lists
the 35 Bengaluru, 7 Araku and 1 Test2 outlet-created records outside the workbook,
current availability differences and ingredient names requiring Stock mapping.

## Outstanding central-workbook SOPs

### No saved SOP — 24 items

- **Herbal Teas (1):** Ayush Tea.
- **Hot Beverages (1):** Pepper Tea.
- **Ice Creams (9):** American Dry Fruit; Black Current Ice Cream; Butter Scotch; Caramel Nuts; Chocolate; Fruit Custard with Ice Cream; Ice Cream with Fruit Salad; Strawberry Ice Cream; Vanilla.
- **Milk Shakes (1):** Guava.
- **Refreshing Drinks (2):** Nannari Sharabath; Sarja Water.
- **Snacks (10):** Cheese Balls; Cheese Maggie; Onion Rings; Osmania Biscuits (1pc); Paneer Momos; Pasta (White/Red Sauce); Peri Peri Fries; Potato Cheese Shots; Veg Fingers; Veg Momos.

### Saved drafts requiring completion — 49 items

- **Immunity Boosters (6):** Aloevera Juice; Ash Gourd Juice; Ragi Java (Curd); Ragi Java (Sweet); TVANAMM's Spl Juice; Wheat Grass Juice.
- **Milk Shakes (10):** Banana; Black Current; Chocolate Milk Shake; Falooda; Kit Kat; Litchi; Oreo; Pineapple; Snickers; Strawberry.
- **Mocktails (6):** Blue Berry; Blue Curacao; Fruit Twist; Lime & Ginger; Lime & Mint; Ras Berry.
- **Premium Shakes (10):** Belgium Dark Chocolate; Belgium Explode; Choco Oreo; Chocolate Brownie; Ferrero; Kitkat Premium; Nutella Brownie; Peanut Butter Banana; Peanut Butter Oreo; Snickers Premium.
- **Refreshing Drinks (6):** Butter Milk; Dryfruit Lassi; Fresh Lime Soda; Lassi; Mango Lassi; Strawberry Lassi.
- **Smoothies (2):** Anjeer Dryfruit; Banana Dates.
- **Snacks (6):** French Fries; Maggie; Sandwich (Cheese); Sandwich (Grilled); Sandwich (Plain); Veg Nuggets.
- **Special Coffees (3):** Butterscotch; Caramel; Hazelnut.

These are the current saved statuses, not instructions to mark them ready without
chef review. Missing quantities, packaging, methods, batch yields and unresolved
questions must be supplied from verified business measurements.

## Existing validation and next checkpoint

The preceding local fixes passed 418 tests across 66 suites, TypeScript, lint and
both production builds in an isolated checkout. Production dependencies now
report zero known audit vulnerabilities; four development-only findings remain
in the lint dependency chain. No tests or production changes were run as part of
this planning-only follow-up.

Next implementation checkpoint: test-only outlet access and a SOP coverage screen
showing ready/draft/missing entries, outlet-created records and unmapped materials.
Then finish recipe mapping and the daily owner/staff inventory path before
activating the reminder worker. Refer to
[release review](stock-release-review-2026-10-10.md) for the existing local fixes
and production deployment gates.
