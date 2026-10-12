# M8 Leads & CRM acceptance

CRM is scoped to an active organization and website. Workspace roles Owner, Admin, Marketing Manager and Sales User can create and manage leads. Viewers and other roles can read records. Writes use optimistic versions, transaction-backed audit entries, and membership validation for assignments.

## Delivered

- Site-scoped lead inbox, pipeline stages, profile and chronological activities.
- Manual and website capture with source and UTM/referrer/landing-page attribution.
- Notes, calls, emails, meetings and follow-up activities; assigned follow-ups and lead ownership.
- Transparent deterministic score v1: base 10; email +25; phone +20; company +10; message of 40+ characters +15; organic/referral/website +10, capped at 100.
- Conversion to Won with optional value; summary and reports computed from persisted records.
- Capture forms have an opaque public ID, selectable fields, and active toggle. Public submission requires the exact verified HTTPS website origin, a configured API origin allowlist, and an idempotency UUID. Repeat submissions return accepted without duplicate leads.
- Public capture does not claim an email, CRM sync, ad source or external provider is connected. Leads are stored in MongoDB; email and messaging delivery are not implied.

## Acceptance checks

1. Add an active verified website and include its HTTPS origin in API `APP_ORIGINS`.
2. Create a capture form from Leads → Capture Forms. Embed a POST to `/api/v1/public/lead-capture/{publicId}` from the verified site with JSON and `X-Growth-Client: web`. Send `name`, email or phone, UUID captureKey, optional attribution and optional details.
3. Confirm the captured lead appears once under the same site, source Website, with a captured activity and score factors.
4. Confirm a different Origin, inactive form, unverified website, wrong tenant/site and invalid fields are rejected or hidden.
5. Create a manual lead, assign an active member, add a note and scheduled follow-up, update its stage with the returned version, convert it, and verify the summary/report reflects persisted rows.
6. Confirm a Viewer can read but receives 403 on create/update/activity/convert/form writes; confirm a stale version receives 409.
7. Inspect organization audit logs for create, edit, activity, conversion and form changes.

CI covers deterministic scoring and UI/API contracts. Production MongoDB and the deployed services remain the source of truth.