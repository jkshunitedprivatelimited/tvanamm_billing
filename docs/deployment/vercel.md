# Vercel deployment

Deploy this repository as two Next.js projects. The application source and user manuals are in `main`; a successful Git push does not itself mean either application has been deployed.

## Projects

| Setting | Business workspace | Billing app |
| --- | --- | --- |
| Suggested project name | tvanamm-admin | tvanamm-billing |
| Root directory | apps/admin-web | apps/pos-web |
| Framework | Next.js | Next.js |
| Node.js | 22.x | 22.x |
| Build command | npm run build | npm run build |
| Include source files outside root directory | Enabled | Enabled |

Import the same GitHub repository twice, choose the intended team, and set each project's root directory. Keep the framework-managed output configuration; the admin app defines its production build directory in `next.config.mjs`. Shared code is in `packages/*` and dependencies use the root npm workspace lockfile.

See Vercel's [monorepo deployment documentation](https://vercel.com/docs/monorepos) and [outside-root source setting](https://vercel.com/docs/monorepos/monorepo-faq).

## Created production projects

The projects were created in the `jkshunitedpvtltd-7603s-projects` Vercel workspace with Node.js 22.x and source files outside the app root enabled. Vercel assigned these domains:

- Business workspace: `https://tvanamm-admin.vercel.app`
- Billing app: `https://tvanamm-billing-pi.vercel.app`

These are the configured production application URLs and allowed origins. A created project or assigned domain is not evidence of a successful deployment; confirm a Ready deployment and the health endpoints before use.

Git pushes authenticate as `TRINADHCREATOR`. New repository commits use that account’s GitHub no-reply identity. Vercel must also recognize the commit author through its GitHub login connection or appropriate team access; changing Git push credentials alone does not grant deployment permission.

## Environment configuration

Configure environment values privately in the intended Vercel projects. Never commit `.env` or paste secrets into the manual. Review `.env.example` and the runtime configuration before deployment.

Both apps need the appropriate database, identity and Supabase configuration:

- `DATABASE_URL` and `STOCK_DATABASE_URL`: separate runtime databases.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`; `SUPABASE_JWKS_URL` if used.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- `IDENTITY_TOKEN_SECRET`: preserve the existing shared identity secret for the existing database. Changing it without a migration plan can invalidate credentials.
- `NEXT_PUBLIC_ADMIN_WEB_URL` and `NEXT_PUBLIC_POS_WEB_URL`: the actual HTTPS deployment domains.
- `ALLOWED_ORIGINS`: the exact allowed HTTPS origins, comma separated. Do not retain localhost as the production application URL.

Configure feature-specific server settings where used:

- MSG91: `MSG91_AUTHKEY`, `MSG91_SMS_TEMPLATE_ID`, `MSG91_SENDER_ID`, `MSG91_OTP_VAR`; widget configuration only if that flow is used. Configure `SUPABASE_SEND_SMS_HOOK_SECRET` when using the Supabase SMS hook.
- AI: `GEMINI_API_KEY`, `ASK_JKSH_MODEL` on the admin application.
- Payments: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and the public key ID where the checkout requires it. Register the real callback/webhook address and verify payment status before launch.
- Stock event processing: `STOCK_EVENT_SECRET` where the configured event transport uses it.

Do not enable development OTP or insecure development authentication in production. Do not share production databases with integration tests or untrusted previews. Vercel supplies the production runtime environment; do not copy `NODE_ENV=development` from a local file.

See [Vercel environment-variable documentation](https://vercel.com/docs/environment-variables).

## Database and background processing

1. Check migration status using the correct production direct connections (`DIRECT_URL`, `STOCK_DIRECT_URL`).
2. Apply outstanding billing and stock migrations through a controlled release task. Do not run development seeds against production.
3. Deploy both web applications and configure the final application URLs.
4. Run low-stock notification processing separately. `npm run stock:alerts` is a long-running worker; `npm run stock:alerts -- --once` is available for a scheduler.
5. Arrange recurring billing-to-stock delivery, inbox processing and reconciliation. The current `/api/v1/stock/relay` endpoint is an authenticated central-admin manual action, not a public cron endpoint.

Deploying the two Next.js applications does not automatically run these background tasks. Do not advertise live stock deduction or alerts until processing is verified. A Vercel cron invokes a configured HTTP route; it does not run an arbitrary persistent Node script. See [Vercel cron documentation](https://vercel.com/docs/cron-jobs).

## Verify the deployed applications

1. Open both HTTPS URLs and verify login and role-specific navigation.
2. Verify OTP delivery to an authorised account and owner invitation links using the production origin.
3. Confirm the owner sees only permitted outlets and the appropriate Help guide.
4. Register the intended billing device and verify the published menu.
5. Use an agreed test transaction to check receipt output, reports and any configured payment callbacks; record and handle that transaction explicitly.
6. Verify local purchase units, the linked expense, stock receipt, count approval and wastage with an agreed test procedure.
7. Confirm recipe-linked stock processing and low-stock notifications once the necessary recipe and item configuration exists.
8. Confirm recovery and offline behaviour on the actual billing device before relying on it during service.

Network printer endpoints on a private outlet LAN may not be reachable from Vercel. Verify the actual supported printer setup at the outlet rather than assuming a localhost printer connection works from a cloud server.
