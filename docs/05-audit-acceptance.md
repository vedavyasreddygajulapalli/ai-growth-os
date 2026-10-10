# M1 audit filtering and export — 10 October 2026

Implementation increment; acceptance testing is deferred at the user's request. Email delivery remains an open issue and M1 is not certified complete.

## Screen and field contract
Settings → Audit logs retains the existing table and activity detail modal. Owner and Admin can open a Filter modal with optional exact-match action (100 characters), record type (64 characters), actor ObjectId, and inclusive UTC date range. Empty fields are omitted. Action accepts letters, digits, underscore, dot and hyphen; record type excludes dot. Invalid fields and reversed date ranges return 422 without replacing the current results. Apply updates the first page; Clear removes filters. Load more retains filters and deduplicates records. Workspace switching clears filters and stale responses are discarded.

The Export JSON modal describes the 1,000-record limit, inclusion of before/after values and private handling. Submit is disabled during the request. Successful exports download a schema-versioned JSON snapshot; an empty match downloads zero items. More than 1,000 matches returns EXPORT_TOO_LARGE with instructions to narrow filters, never silently truncates. Existing inline errors and form input retention are reused. No destructive action is introduced; audit records stay immutable. No retention deletion policy is enabled.

## API contract
- GET `/api/v1/organizations/:orgId/audit-logs`: optional action, entityType, actorId, from/to (UTC ISO timestamps), cursor and limit (1–100, default 25). Returns items and nextCursor, ordered by descending ObjectId.
- POST `/api/v1/organizations/:orgId/audit-logs/export`: JSON body containing only the five filter fields. Returns schemaVersion=1, orgId, exportedAt, filters, count and items. No cursor or client tenant override is accepted.
- Both require authenticated, verified Owner/Admin membership. Export also requires the existing Origin and X-Growth-Client protection. Export rechecks membership inside a MongoDB transaction, reads tenant-scoped records, and appends audit.exported before returning. Export logs contain filter metadata/count, not a second copy of exported records. The export's own event is outside its returned snapshot.
- Existing immutable audit records have no write/version controls because neither endpoint updates them. Current redacted before/after values are retained. Responses use the existing error envelope and no-store policy.

## Deferred acceptance criteria
1. Owner/Admin can filter, paginate, clear, view details and download the same matching records. Verify an inclusive full UTC day and dates containing fractional seconds.
2. Viewer gets 403; nonmember gets 404; unauthenticated callers get 401. Tenant injection and query operators get 422. Permission revocation racing export prevents unauthorized output.
3. Export includes no authentication or ownership verification secrets. Exactly 1,000 records export; 1,001 records fail with no partial download or success audit event.
4. Export and audit commit atomically. A database failure returns an error and no success download. Empty exports work.
5. Repeated pagination clicks create no duplicates; workspace switch during a request cannot display/download the previous tenant's response.
6. Verify mobile filter modal scrolling, table overflow, keyboard access, download support, loading, errors and retry with the existing premium styles.

Automated validation and permission scenarios were added to the existing contract and MongoDB integration suites; they have not been executed for this increment. Full live/browser verification remains deferred.
