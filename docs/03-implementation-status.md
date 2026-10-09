# Foundation increment — implementation and verification

9 October 2026. This is an implementation handoff, not a production-readiness certification.

## Implemented
- Existing approved visual system and ten-module navigation preserved; original prototype assets remain intact.
- Next.js + TypeScript entry point with a same-origin `/api` proxy and an incremental legacy UI bridge. This is not yet a full React component migration or shadcn/Tailwind conversion; each real module must replace its legacy section without redesign.
- NestJS + Mongoose API: email/password registration/login/logout/session; workspace create/list/switch/preferences; seven fixed roles; invitations with one-time manual-share links; membership edits/removal/ownership transfer; website create/read/edit/archive; DNS TXT verification; append-only redacted audit writes.
- MongoDB schemas and indexes for seven foundation collections. Sessions contain token hashes; passwords are salted scrypt hashes. Workspace writes and audits use transactions.
- Strict DTO validation, request IDs, role and tenant checks, API throttling, origin/header CSRF checks, expiring HttpOnly cookies, version conflict checks.
- Real-workspace UI reads/writes the API; it never copies prototype sample data into tenant records. Until connected, the existing hosted preview clearly reports the service unavailable.
- 104 screen/shared-flow specifications, 63 target collections, initial 23-operation OpenAPI document, connector workflows and milestone gates.

## Verification completed
| Check | Result |
|---|---|
| NestJS TypeScript build | Passed |
| Next.js production build | Passed |
| Domain safety/canonicalization contract | Passed |
| Strict body/timezone/currency/version validation | Passed |
| Role grant hierarchy | Passed |
| Password hashing and cookie policy | Passed |
| MongoDB index declarations | Passed (schema check only) |
| Ten-module UI and unavailable-service state | Passed in jsdom |
| Live adapter API reads and no browser persistence | Passed with stubbed API responses |
| Form input retained after API validation error | Passed with stubbed API response |
| Real MongoDB integration scenarios | Blocked before execution: environment denied MongoDB startup (`open: Operation not permitted`) |
| Browser visual/responsive QA | Not run; approved CSS/layout retained. DOM checks are not visual QA. |
| Live Atlas / external backend / DNS verification | Not configured or end-to-end verified |

The nine integration scenarios are supplied in `backend/test/foundation.test.ts`: real session creation, unauthorized/CSRF rejection, organization/audit transaction, website duplicate/concurrency, invitation email/single-use/role checks, cross-tenant access, verification invalidation/audit redaction, owner protection/revocation, logout invalidation. Their attempted run did not reach assertions; no database pass is claimed. CI is configured to run them on a host that supports MongoDB.

## Required next action
Connect an Atlas replica-set database and deploy the Node backend; set the frontend's server-only API_INTERNAL_URL and the backend's exact APP_ORIGINS. No credentials are included in this deliverable. Run integration tests and validate register → workspace → invite/accept → website → edit → audit → logout in the real deployment. Only then enable the hosted real-workspace path.

## Remaining M1 gates
Email verification/password reset and configured transactional email provider; shared Redis-based rate limiting for multi-instance deployment; account/session management; permission-concurrency and ownership-transfer integration verification; index migrations; audit retention/export policy; operational monitoring and tested backup/restore. Manual invitation links work at the code level but actual delivery is left to the user; this build sends no email.

## Remaining sequence
M2 verified crawler and URL inventory → M3 Brand/Media → M4 Research/Strategy → M5 Content/Design → M6 WordPress → M7 SEO/Indexing → M8 CRM → M9 Analytics → M10 Assisted agents → M11 Billing → M12 production hardening. These have specifications, not completed backend implementations. Do not bypass M1 acceptance to seed more fake records or call the system production-ready.
