# M1 live acceptance deployment

This is an acceptance environment, not a production-readiness declaration. Existing UI preview remains available separately. No Render services existed when this configuration was prepared.

## Setup

1. Import the repository with Render Blueprint: https://dashboard.render.com/blueprint/new?repo=https://github.com/vedavyasreddygajulapalli/ai-growth-os
2. Keep both services on the explicit free plan. Review generated service URLs before configuring origins. MongoDB is provided separately by Atlas; this Blueprint does not create it.
3. In the API's environment settings, enter the Atlas replica-set connection string as `MONGODB_URI`. Use a database user scoped to the application database and allow the API service's outbound addresses in Atlas. Never commit the URI.
4. Set `APP_ORIGINS` and `PUBLIC_APP_URL` to the exact frontend HTTPS origin, without a trailing slash. Set `EMAIL_FROM` to the verified sender and `RESEND_API_KEY` to the provider credential. Enter secrets only in service settings.
5. Set the frontend's server-only `API_INTERNAL_URL` to the API's assigned HTTPS origin, without `/api` or a trailing slash. Rebuild the frontend after changing it: Next rewrites are configured at build time. No browser database connection is used.
6. Deploy API first, then frontend. Automatic deployments are deliberately disabled until live acceptance passes. The API start command runs the idempotent account migration/index initialization before accepting requests. A failed migration must block startup; do not bypass it.

If assigned URLs are only available after service creation, update those environment values before testing and rebuild the frontend. Do not test with placeholder origins.

## Required checks

- API `/api/v1/health` returns 200 with database connected; inspect deploy logs without copying credentials.
- Register through the frontend; verify real email arrival and one-time link use. Unverified accounts cannot access tenant routes.
- Verify login/logout, expired verification link, forgot/reset password, old-session rejection after reset, own device revocation and logout-all.
- Create two workspaces and websites. Check switching, membership changes, invitation acceptance and cross-tenant rejection using distinct test accounts.
- Edit records concurrently and confirm stale versions produce a conflict without overwriting changes. Verify website archive confirmation and redacted audit records.
- Check account forms, tables, drawers and navigation at mobile and desktop sizes; ensure real loading, error and empty states work.
- Record deployment IDs, commit SHA, test timestamps and actual results. Do not mark unexecuted steps passed.

Before production: resolve the documented shared/proxy-aware throttling gate, rehearse migration and backup restore, and configure monitoring/retention. The test email sink used by CI is never available in production. Do not start M2 until M1 acceptance is closed.
