# Configurable stock alerts: rollout

## Implemented

Every active Stock item can have its own minimum per outlet, expressed in its
own base unit or compatible kg/litre/dozen conversion. No 3 kg default is set.
Zero is a valid limit. Disabled rules remain saved and can be re-enabled.

The worker evaluates usable sellable stock (on-hand minus allocated) across
eligible batches, excluding quarantined/recalled/expired stock. A low episode
opens at quantity <= limit and closes above it or when the rule is disabled.
It scans current balances rather than writing notifications during billing.

The rule state and outgoing notification event commit together. Identity receives
central-admin and franchise-owner notices in a separate transaction. Retries use
an episode-specific unique key and do not reopen read/resolved notifications.
Recovered episodes resolve notices; another shortage gets a new episode.

UI paths:

- Owner: Stock & orders → Stock alerts & limits.
- Central: Stock control → Outlets needing stock / Outlet stock limits.
- Bell notice: View stock alerts opens the authorized outlet context.

## Rollout status — 2026-09-15

The user explicitly approved rollout. Applied shared Stock migrations:

- 0010_owner_returns.sql
- 0011_return_lifecycle_capabilities.sql
- 0012_low_stock_alerts.sql

The Stock module is enabled in the configured non-production environment.
The user's existing single outlet was linked using its verified Billing
organization/franchise/timezone. No balances, prices or limits were invented.
Live Razorpay remains disabled, and the payment route now enforces that flag
for live keys. Payment creation also requires the webhook secret.

The worker passed a shared-database `--once` run (zero errors) and is running
as a local development process. No business alert limits exist yet. The local
process is not a durable hosted deployment and will need restarting after exit
or machine restart.

### Before business use

1. Enter verified opening stock through Counts & wastage and set appropriate
   per-item limits under Inventory & stock limits.
2. Review the supply catalogue, prices, pack sizes and delivery rules.
3. Configure `RAZORPAY_WEBHOOK_SECRET` in the deployment environment and complete
   provider test-payment/webhook checks before enabling live payments.
4. Deploy application code and run `npm run stock:alerts` under a process supervisor
   with `DATABASE_URL` and `STOCK_DATABASE_URL`. Alternatively schedule
   `npm run stock:alerts -- --once` regularly. For local `.env` use
   `npx dotenv -e .env -- npm run stock:alerts`.
5. Verify an approved test shortage and replenishment. No real payment or
   fabricated shortage was submitted during this implementation pass.

Validation: all 12 Stock integration suites (62 tests) pass against separate
local Billing and Stock databases; production admin build passes. Tests include
order retry deduplication, owner history permissions, pending deliveries, returns,
alert units/scoping, durable delivery retries and episode recovery.

Each worker cycle handles up to 500 rules and 100 pending notifications, with a
30-second interval. Large backlogs require more frequent cycles or a larger
bounded batch. Delivery failures stay pending and are counted in worker logs;
alerting the deployment operator on repeated failures is a deployment task.
Stock recovery/expiry detection is periodic, not instantaneous. Offline sales
are reflected only after the existing billing-to-stock relay processes them.

Hosted worker supervision and payment-provider setup remain deployment requirements.


## Connection issue still observed

The direct Stock Supabase hostname intermittently returns ENOTFOUND in the local
runtime. Shared migrations and owner read checks succeeded, but a subsequent
browser request reproduced the resolver failure. Connection acquisition now
retries DNS errors twice with a short delay; transactions are never replayed.
This mitigates brief failures and does not repair an unavailable DNS endpoint.
Use the project's verified Supabase pooler connection string for the runtime if
this persists; keep a separate direct migration connection. No guessed pooler
host, IP override or credential change was applied.
