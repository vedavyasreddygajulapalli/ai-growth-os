# M1 account security increment

This extends the approved Settings experience. No navigation modules, visual tokens, typography or base CSS are replaced. M2 remains gated by M1 live acceptance and operational requirements.

## Screens and states

| Screen / entry | Fields and real data | Actions / API | Permission and states | Acceptance |
|---|---|---|---|---|
| Sign in | Email, password | Existing login; open forgot-password form | Public; submitting, invalid credentials, throttled, service unavailable | Correct password issues HttpOnly cookie; invalid login does not reveal account existence |
| Verification gate | Signed-in email, emailVerifiedAt | POST auth/email-verification; refresh session; sign out | Authenticated; workspace routes require verified email; email provider missing/failure shown | Unverified accounts cannot access organization/team/website data, including direct API calls |
| Verify link | 64-character token read from URL fragment into memory | POST auth/email-verification/complete on explicit confirmation | Token possession; success, expired/used/wrong-purpose link, rate limit | Token expires after 24 hours, stored only as hash, consumed atomically; no auto-consumption by a link scanner |
| Forgot password | Email | POST auth/password-reset | Public; same accepted response for existing and absent accounts; unavailable provider returns 503 before account lookup | No token, password hash or recipient-existence flag returned; provider failures logged without secrets |
| Reset password | Fragment token, new password (12–128 characters) | POST auth/password-reset/complete | Valid token; submitting, invalid/expired link, success | 30-minute token is purpose-bound and single-use under concurrency; all sessions and remaining tokens revoked |
| Account & security | Name, email, verification status, profile version | PATCH auth/account | Own account only; version conflict preserves input | Unknown privilege fields rejected; stale profile cannot overwrite newer values |
| Change password | Current password, new password | POST auth/password | Own authenticated account with current password; incorrect-password error, conflict, success | Revokes all sessions and recovery links; no automatic sign-in after change |
| Signed-in devices | User agent label, createdAt, expiresAt, current flag; latest 100 sessions | GET auth/sessions; DELETE auth/sessions/:id; POST auth/logout-all | Own sessions only; confirmation before revocation | Other-user session IDs return 404; current session cookie cleared; stale-generation sessions cannot survive logout-all |
| Recent account activity | Last 25 actions and times | GET auth/security-events (API cursor pagination supported) | Own account only; empty, loading, error | No token/password/email payload in events; tenant workspace audit remains separate |
| Archive website | Existing edit form followed by confirmation | Existing versioned website PATCH | Owner/Admin | Explicit archive confirmation; a stale version cannot archive a newer record |

All forms reuse existing modal, field, button, helper, note, card and status components. Requests use the same-origin API adapter and keep records in MongoDB. Mobile layout inherits the approved responsive system; full browser visual QA remains a release gate.

## Collections and token lifecycle

- `users`: add emailVerifiedAt (null until verified), authVersion and profile version.
- `sessions`: add authVersion and a truncated user-agent device label; tokenHash excluded from selection and serialization.
- `auth_tokens`: userId, kind (verify/reset), tokenHash, authVersion, expiresAt. Unique hash, TTL expiry, user/kind index. Expiry is checked in queries, independent of asynchronous TTL cleanup.
- `email_cooldowns`: one atomic 60-second slot per user/kind, TTL-cleaned. Concurrent requests cannot send a burst from separate API instances. Failed sends release their slot.
- `security_events`: userId, action, requestId, timestamps; user-scoped descending index. No credential payloads.
- Membership writes take a transactional authorization lock by incrementing an internal authorizationRevision. Role/removal writes and protected mutations therefore conflict/retry against the current role. The internal field is redacted from workspace audit snapshots.

Password hash changes increment authVersion. Sessions with older versions are rejected even if concurrent issuance occurs after deletion. Reset token consumption, password change, session deletion and security audit are in one MongoDB transaction. Provider delivery is outside the transaction. A failed send invalidates its token; retry requires a new request. Verification is requested explicitly after registration, allowing account/session access even while email configuration is unavailable.

## Live email configuration

The first transport implementation uses the Resend HTTPS API with a 10-second timeout and a token-derived idempotency key. Reference: https://resend.com/docs/api-reference/emails/send-email . No actual email has been sent by this development run.

Configure server-only `RESEND_API_KEY`, `EMAIL_FROM` (verified sender), and `PUBLIC_APP_URL` (trusted HTTPS frontend URL, without query/hash). None belongs in GitHub or a public frontend environment variable. Verification/reset URLs use fragments so tokens are not sent as URL queries to the frontend server. UI removes the fragment token immediately and requires explicit submission.

The test transport is available only with NODE_ENV=test. Integration tests capture test messages in process memory; all user/session/token/tenant data and transactions use a real MongoDB replica set. Tests do not prove live inbox delivery.

## Migration and operations

Run `npm ci --prefix backend`, `npm run build --prefix backend`, then `npm run db:migrate --prefix backend` with MONGODB_URI injected securely. The idempotent migration backfills account/session versions and creates indexes. Legacy accounts remain unverified; do not silently grandfather them as verified.

Restore rehearsal: restore an Atlas backup into an isolated database; run migration, health check, and a dedicated test-account authentication/workspace/website smoke test; confirm tenant separation before any production cutover. No restore or backup configuration has been executed here.

Before M1 completion: provision Atlas and email sender; deploy backend and same-origin frontend proxy; verify live register → verification → workspace → invitation/accept → website/edit/archive → audit → logout; verify live recovery, device revocation and DNS ownership; validate proxy-aware shared rate limiting, monitoring, retention and restore; complete responsive browser QA. Only after these gates pass may M2 crawler implementation be marked ready to start.

### Hardening verification
Provider transport now has explicit mocked success, provider rejection and network failure tests. Shared Redis rate limits fail closed, sessions retain secure cookie semantics, and production origin configuration is validated before startup. Live inbox delivery remains a deployment-only gate when provider configuration is unavailable; it is not replaced with an insecure email-verification bypass.
