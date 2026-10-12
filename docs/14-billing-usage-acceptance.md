# M11 Billing and usage acceptance

The billing boundary is provider authoritative. Client requests cannot select a paid status, plan entitlement, or invoice state. The configured Stripe webhook uses the raw request bytes, timestamp tolerance, HMAC signature verification, unique provider event IDs, and one MongoDB transaction for event receipt, subscription projection, and audit. Until a checkout adapter and credentials are deliberately configured, checkout returns an explicit unavailable response and subscription reports `not_configured`.

The first usage meter counts persisted, successful Content AI proposals only. It is derived from tenant scoped MongoDB records, attributes retry attempts to the original request key, and writes idempotent usage events. Limits remain null until authoritative subscription entitlements exist. Empty usage is an actual empty list, not a fabricated estimate.

Acceptance:
- Owner/Admin only for billing and usage; every organization query is scoped.
- Webhook signature is checked against raw bytes and rejects absent, malformed, stale, and invalid signatures.
- Duplicate Stripe event IDs are idempotent; subscription state comes only from verified provider events.
- Webhook audit is transactional and excludes raw payloads and credentials.
- Checkout cannot change billing state and reports unavailable until a real adapter is configured.
- Successful AI proposals create settled usage events once; retries reuse the originating event key.
- Billing credentials and signed payloads are not returned or stored in subscription snapshots.
- Backend build, unit/integration suite, and frontend production build pass.
