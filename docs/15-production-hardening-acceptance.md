# M12 Production hardening and release gates

## Evidence required before declaring production readiness

- Main CI on the exact release SHA: API and web production builds, unit/UI tests, MongoDB replica-set integration tests, Redis-backed throttling tests, repeated index migration, and UI source/public asset synchronization.
- Staging smoke test through the existing Render web origin and same-origin API proxy: readiness, registration, verified account, workspace/site isolation, role denial, version conflicts, audit, CRM, content, SEO, analytics, agents, billing/usage empty state, and sign-out.
- Review current production dependency advisories and record the exact lockfile SHA and output. Resolve exploitable runtime vulnerabilities before release.
- Verify production configuration: exact HTTPS origins, MongoDB least privilege and replica-set transactions, trusted proxy list, shared Redis for multi-instance rate limits, verified email sender, secret rotation, and provider credentials held only in service settings.
- Rehearse additive migration rollback, encrypted database restore, recovery time and recovery point, alert routing, log redaction, retention policy and legal holds.
- Complete mobile/desktop keyboard and visual review for the existing premium shell and ten modules.
- Run the documented M1 account, email, DNS, team, session, and M2 worker/crawl recovery acceptance using isolated real accounts and a verified owned domain.
- Complete real WordPress, Search Console, ranking, AI visibility, AI model, and billing provider acceptance only when corresponding customer accounts and credentials are configured.

## M12 verification added

A MongoDB replica-set integration regression signs a Stripe event over the exact raw HTTP body, sends the webhook without a browser Origin header, confirms the request passes the origin guard only because provider signature validation applies, verifies tenant-bound subscription projection and audit, and replays the same event to prove idempotency. An invalid signature leaves no event or subscription record.

M9/M10 and M11 have green CI on main and have been deployed together at their respective ordered checkpoints. The current M11 live services use the merged release checkpoint documented in `03-implementation-status.md`.

## External/live gates

Code and CI verification do not replace live account or infrastructure acceptance. Do not mark production ready while email inbox delivery, real DNS ownership, worker outage recovery, backup restore, alert delivery, provider OAuth/sync, WordPress remote reconciliation, billing checkout/webhook credentials, mobile visual review, or production load tests remain unverified. No sample or test data is presented as tenant data, and no provider metric, paid status, or invoice is fabricated.

## Webhook conflict hardening (2026-10-12)

Duplicate acknowledgement now requires a committed receipt for the same provider event ID and the same payload hash. Reusing an ID with changed content returns 409. A subscription/customer unique-index conflict also returns 409 instead of falsely acknowledging receipt; the transaction rolls back the receipt, projection and audit so a corrected event can be retried. Integration coverage includes changed payloads, cross-tenant customer conflicts, recovery after rollback, and concurrent identical delivery.

Local verification: API build, 38 unit/UI tests and web production build passed. The Redis test was skipped locally because no Redis test URL was configured. MongoDB integration could not start locally (`open: Operation not permitted`); GitHub's replica-set/Redis CI remains the merge gate.

Production dependency audit on 2026-10-12: `npm audit --omit=dev --json` returned zero known vulnerabilities for both lockfiles. This is point-in-time advisory evidence, not a guarantee against unknown vulnerabilities.

- Backend lockfile SHA-256: `11288ad8f7572d589bf5ce7b535ac6de33989044363357d516de6b577c2936a3`.
- Web lockfile SHA-256: `a0af0fb804998080eabc3448893bcb6f8e3a37a441926fc1b43881a6d2a92436`.

The external/live gates above remain open; this checkpoint does not declare production readiness.
