# M5 / M6 development checkpoint

## Working code paths
- Tenant/website-scoped content library, safe structured text blocks, briefs, assignment, evidence/media references, templates, editorial checks, escaped previews.
- Draft autosave, optimistic conflicts, immutable content revisions, restore-as-draft, review/change/approve/archive transitions. Edits clear approval. Independent review is the default; Owner self-approval requires an explicit exception and audited reason for that revision.
- AI provider abstraction, disabled by default. Requests use approved tenant knowledge, bounded input/output, daily development budget and explicit proposal application. AI never approves or publishes.
- WordPress application credentials encrypted with AES-256-GCM and tenant/site AAD, HTTPS-only verified domain, public DNS checks, pinned socket address, no redirects, timeout and response bounds. Credential projections/audits exclude secrets.
- Idempotent remote post/page import into a local draft, with explicit acceptance of simplified formatting and no implicit remote write.
- WordPress post/page draft sync, approved publishing/scheduling, queued cancellation and publishing history. MongoDB is the job source; BullMQ/Redis dispatch runs in the existing supervised worker. No additional paid infrastructure is provisioned.
- Worker rechecks membership, verification, website/connection versions and approval revision. Published posts cannot be downgraded by draft sync. Remote modified timestamps protect against overwriting newer edits.
- Uncertain POST outcomes require read-only reconciliation; matching content/revision markers bind the result. No blind retry. A confirmed remote draft can be published using a new request against the same remote ID. No matching result stays blocked for manual investigation.

## Acceptance tests
`npm run test:unit --prefix backend` includes rendering/validation, encryption tenant binding, marker revision boundaries and the connected Content UI.
`npm run test:integration --prefix backend` includes real MongoDB persistence, idempotency, tenant/role checks, immutable versions, approval reset, schedule locks/cancel, mocked WordPress uncertain outcomes, published-draft protection, permission revocation and AI proposal single-use.
Backend TypeScript and frontend production builds are required. Local MongoDB startup currently exits with code 100 before assertions; GitHub CI is the integration acceptance authority. A failed startup is not a passing test.

## Configuration
- `CMS_ENCRYPTION_KEY`: secret base64-encoded 32 random bytes, API and publishing worker. Preserve across deploys. Rotation requires a planned credential re-encryption migration; do not casually replace.
- `REDIS_URL`, `CRAWLER_ENABLED=true`: existing free worker infrastructure; the publisher currently shares that worker lifecycle. Keep a dedicated production worker as the eventual scaling target.
- `CONTENT_AI_ENABLED=false` by default. Optional `OPENAI_API_KEY` and `CONTENT_AI_MODEL` enable real provider calls only after explicit configuration. Provider fees may apply; no key or paid model is provisioned here.
- WordPress credentials are supplied through the website's authenticated connection form, never committed to the repository.

## Remaining M5 / M6 gates — not complete
- WordPress media upload/mapping and featured image support; selected media currently represents internal references only, not uploaded remote assets.
- Rich Gutenberg/layout round-tripping. Import supports safe text blocks with explicit formatting acceptance; arbitrary HTML/layouts are not supported.
- Registered SEO-plugin meta adapters; SEO title/description are local editorial metadata, not a claim of Yoast/RankMath synchronization.
- Design intelligence/template expansion and refresh-candidate workflow from the full PRD.
- Full editor keyboard/mobile visual acceptance and additional scheduling/recovery stress tests.
- Secure server key configuration, real WordPress application credentials, live publish/update/reconcile acceptance, real AI provider acceptance, and deployment of this pair after the remaining implementation gates.

Do not label this checkpoint M5/M6 complete or start M7 on this evidence. Existing deployment remains the M3/M4 checkpoint until a separately recorded deployment succeeds.

CI run 38113634527 on commit `4352a3644eec7a49b4157540186a8c586d3d654e` passed 29 unit/UI tests and 35 MongoDB/Redis integration tests, zero skips, and both builds. Subsequent remote-import and origin-binding changes require a fresh CI result.

Latest code checkpoint: `ae83aef2e00aa709d769f8eade5e95ea432cdd69`. GitHub CI run https://github.com/vedavyasreddygajulapalli/ai-growth-os/actions/runs/38113853672 passed backend/frontend builds, 30 unit/UI tests and 36 real MongoDB/Redis integration tests, zero skips. This verifies the safe-block import, independent-review exception, remote-origin binding, approval and mocked-provider flows. It is not live WordPress, AI-provider or deployment evidence.

## Featured images and refresh follow-up

Implemented: explicit featured-image selection (uploaded PNG/JPEG/WebP only), strict tenant validation, approval invalidation on change, worker-side private GridFS read, bounded binary WordPress upload, checksum/origin mapping reuse, and read-only deterministic-slug recovery after lost upload responses. The publish confirmation discloses public upload. Clearing the selection preserves the remote image; remote image deletion is not implied. Ambiguous media outcomes without a unique match remain blocked, requiring operator investigation. Other media references remain internal; inline galleries/custom layouts are not yet supported.

Implemented: age-based refresh candidates (90-day default, configurable API threshold), with an explicit explanation that this is not traffic/ranking intelligence. Beginning a refresh creates an audited, unapproved draft revision and keeps the live remote mapping. WordPress remains unchanged until a newly approved publish request.

Pending: expanded design intelligence/templates, inline-media/layout round-tripping, registered SEO-plugin adapters, live WordPress/AI acceptance and the combined deployment. Do not mark the whole pair complete from this checkpoint.
