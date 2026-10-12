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
