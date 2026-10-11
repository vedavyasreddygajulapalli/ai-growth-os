# M3 Brand & Knowledge / M4 Research & Strategy

## Development contract

The current ten-module information architecture and stylesheet are unchanged. Brand, Research and Strategy use the existing foundation adapter and reusable form/modal/table/card patterns. No localStorage prototype records are promoted into live workspaces.

The machine-readable field catalog is `backend/src/knowledge/catalog.ts`; strict per-kind DTOs reject unknown fields. Records use `orgId`, `websiteId`, `kind`, title, status, data, references, source, timestamps, updatedBy and optimistic version. Collections: `knowledge_records`, `brand_media.files`, `brand_media.chunks`. Unique scoped keys enforce one business/voice/design profile per website, including archived profiles (restore/edit rather than duplicate). Migrations create indexes idempotently.

All members can read within their active organization and active website. Owner/Admin/Marketing Manager/SEO Manager/Content Writer can write; only Owner/Admin/Marketing Manager can approve. Sales User/Viewer cannot write. Sensitive mutations recheck membership transactionally and serialize against website archival. References must exist in the same website; assigned owners must be active organization members. Append-only audit events retain before/after and request/actor context. No client-supplied tenant, file IDs, versions or approval roles are trusted.

## Screen coverage and states

- Business profile: industry, description, positioning, proposition, differentiators, markets, locations, goals.
- Services/products: descriptions, features, benefits, pains, audience, keywords, page URLs, pricing notes.
- Audiences: persona, role/industry, pains/needs, objections, motivations, intent/funnel.
- Competitors: URL, positioning, strengths/weaknesses, tracked URLs and notes.
- Voice/design: structured brand guidelines, logo URL, colors, type, image/button rules and do/don't guidance.
- Claims/proof/sources: evidence, usage restrictions, source URLs, review date/freshness. Brand Memory includes approved, unexpired brand records only and retains IDs/versions; bounded at 500 with explicit truncation.
- Media: private uploads, authenticated attachment downloads, linked assets/videos, folder/tags/alt/caption/rights/usage metadata. Files never execute inline; no public bucket. Signature checks are format checks, not malware scanning.
- Knowledge sources can import actual crawled titles/descriptions as draft records with snapshot provenance, idempotently. Full-page text extraction is not implied.
- Research: projects, optional sourced keyword measurements, topics/clusters, groups, findings, opportunities, context from M2/M3 and exact-phrase coverage candidates.
- Strategy: evidence-linked recommendations, impact/effort/confidence/priority, assigned tasks and date-range planning calendar.

Each list has website selection, title/status filters, cursor pagination, explicit loading/empty/error states. Editors preserve unsaved fields on errors and require version matching. Archived records stay auditable; confirmation precedes archival. Destructive hard deletion is not exposed. Unknown numeric measurements remain absent. Success notifications occur only after successful API writes.

## Essential acceptance tests

- Persist brand draft; exclude it from memory until approved; deny writer approval; reject stale update.
- Deny Viewer writes, outsider reads, cross-website references and direct media downloads.
- Persist research → evidence-linked task; retrieve calendar/context from stored data.
- Enforce singleton uniqueness, valid dates/URLs/numeric ranges and unknown-field rejection.
- Upload private bytes, download through authorized route; reject invalid/mismatched/oversized media.
- Keep all ten navigation entries, saved UI data and Viewer restrictions.

These tests are implemented. Record successful CI evidence in implementation-status only after the actual run passes.

## Deployment checkpoint and remaining limits

Deploy once after the M3/M4 code gate is green, run migrations/readiness and exercise one primary workflow for each with an authenticated account. No verified account is invented or bypassed for acceptance. Keep free crawler deployment opt-in. Live DNS/email, production persistent Redis/dedicated worker and broad mobile/security/performance checks remain later gates.

Current research is a manual/evidence workflow plus deterministic crawl-metadata coverage, not a live external keyword data service. Linked media URLs are stored, never fetched by the API. Uploaded files are limited to development sizes; video upload/transcoding, malware scanning, object-storage lifecycle and crash-orphan GridFS cleanup remain hardening work. Media folder/tag/usage values are stored metadata, not an automatic downstream usage tracker. Brand-source file text extraction and automatic competitor crawling are not claimed. Calendar is a date-range agenda rather than a drag-and-drop scheduler. These limits must remain visible in future milestone acceptance.
