# MongoDB model and backend workflow plan

## Shared schema conventions
All documents have `_id:ObjectId`, `createdAt:Date`, `updatedAt:Date`; mutable business records also `version:int`. “org” scope requires `orgId:ObjectId`; “site” adds `websiteId:ObjectId` with same-org relationship validation. Both are server-derived/validated, never copied blindly from bodies. Global users can have many memberships. Organization is the V1 workspace; each has exactly one active Owner. Reference deletion is explicit: archive first; block removal of referenced evidence/media; background purge after retention and legal holds. MongoDB does not enforce foreign keys: service must resolve references with orgId before write.

Use a replica set/Atlas for multi-document transactions. Create collections/indexes in migration before traffic. Migrations use a lock and version ledger; append, never mutate an applied migration. Default reads primary for authorization. Bind every mutation and its audit/outbox to one session; no external I/O inside retryable transaction callbacks. Uniqueness is database enforced, not pre-check alone. Cursor uses stable `_id` in current foundation; richer modules use `(createdAt,_id)`. Foundation session TTL is cleanup only; expiry is enforced on every request.

## Collections
The following is the target schema, not a claim that every collection is implemented. `!` required, `?` optional/null. All string and array lengths receive DTO limits. Foundation implementation initially creates only users, sessions, organizations, memberships, invitations, websites and audit_logs.

### `users` · global
- Fields: `name:string,email:string!,passwordHash:string!,status:active|disabled,emailVerifiedAt:date?`
- Indexes: `email unique`
- Lifecycle: No password/token in projections;delete via anonymization workflow

### `sessions` · user
- Fields: `userId:ref(users),tokenHash:string!,expiresAt:date!`
- Indexes: `tokenHash unique; expiresAt TTL 0`
- Lifecycle: 7 days;explicit expiry query because TTL asynchronous

### `password_resets` · user
- Fields: `userId:ref(users),tokenHash:string!,expiresAt:date!,usedAt:date?`
- Indexes: `tokenHash unique;expiresAt TTL 0`
- Lifecycle: 30 minutes;single-use, revoke all sessions

### `organizations` · tenant root
- Fields: `name:string!,timezone:IANA!,currency:ISO4217!,status:active|suspended,version:int`
- Indexes: `createdAt,_id`
- Lifecycle: Soft-delete pending export and retention review

### `memberships` · org
- Fields: `userId:ref(users)!,role:enum!,status:active|removed`
- Indexes: `orgId+userId unique; orgId partial role=Owner unique`
- Lifecycle: Removed records retained for audit;queries active only

### `invitations` · org
- Fields: `email:string!,role:enum!,tokenHash:string!,expiresAt:date!,status:pending|accepted|revoked`
- Indexes: `tokenHash unique;orgId+email partial status=pending unique`
- Lifecycle: 7 days;purge token hash after acceptance/expiry

### `roles` · global definitions V1
- Fields: `key:string!,permissions:string[],revision:int`
- Indexes: `key unique`
- Lifecycle: Seven code-defined immutable roles;custom records V2

### `websites` · org
- Fields: `name:string!,domain:string!,cmsType:WordPress|Webflow|Shopify|Custom|Other,status:active|archived,verificationStatus:unverified|verified,verificationToken:string!,verifiedAt:date?,version:int`
- Indexes: `orgId+domain unique;orgId+createdAt+_id`
- Lifecycle: Archive retains history;domain edit invalidates verification and connections

### `website_crawls` · site
- Fields: `status:jobState,limits:object,startedAt:date,finishedAt:date?,counts:object,error:object?`
- Indexes: `orgId+websiteId+createdAt`
- Lifecycle: 90-day raw evidence, longer aggregate history

### `website_urls` · site
- Fields: `url:string!,urlHash:string!,httpStatus:int?,canonical:string?,robots:object,indexability:enum,lastCrawledAt:date?,sources:string[]`
- Indexes: `orgId+websiteId+urlHash unique`
- Lifecycle: Archive stale URLs;do not delete content relationships

### `integrations` · site
- Fields: `provider:enum!,status:enum!,propertyId:string?,secretRef:string?,scopes:string[],lastSyncAt:date?,error:object?`
- Indexes: `orgId+websiteId+provider+propertyId unique`
- Lifecycle: Encrypted external vault envelope;delete secret on disconnect

### `brand_profiles` · org
- Fields: `name:string!,industry:string,description:string,voice:object,locations:object[],version:int`
- Indexes: `orgId unique`
- Lifecycle: Version changes audited;profile is org-level, site override explicit

### `products` · org
- Fields: `name:string!,sku:string?,priceMinor:int?,currency:string,benefits:string[],evidenceIds:ref[]`
- Indexes: `orgId+sku partial sku exists unique`
- Lifecycle: Archive if referenced

### `services` · org
- Fields: `name:string!,description:string,locations:string[],faq:object[],evidenceIds:ref[]`
- Indexes: `orgId+name`
- Lifecycle: Archive if referenced

### `audiences` · org
- Fields: `name:string!,roles:string[],problems:string[],goals:string[],objections:string[],stage:enum`
- Indexes: `orgId+name`
- Lifecycle: Archive,retain content links

### `competitors` · site
- Fields: `name:string!,domain:string!,approved:boolean,notes:string`
- Indexes: `orgId+websiteId+domain unique`
- Lifecycle: Archive;retain research evidence

### `claims` · org
- Fields: `claim:string!,evidenceIds:ref[],status:knowledgeState,validUntil:date?,verifiedBy:ref(users)?`
- Indexes: `orgId+status+validUntil`
- Lifecycle: Restricted/expired excluded from retrieval

### `proofs` · org
- Fields: `title:string!,type:enum,sourceId:ref,mediaId:ref,consentNote:string,status:knowledgeState`
- Indexes: `orgId+status`
- Lifecycle: Soft-delete and downstream-use check

### `knowledge_sources` · org
- Fields: `title:string!,type:enum,url:string?,blobKey:string?,status:knowledgeState,checksum:string,visibility:enum`
- Indexes: `orgId+checksum`
- Lifecycle: Private object storage;signed URLs;retention tied to source policy

### `knowledge_chunks` · org
- Fields: `sourceId:ref!,text:string!,embedding:vector,model:string,claimIds:ref[],status:enum`
- Indexes: `orgId+sourceId+chunkIndex unique;Atlas vector index with orgId/status filter`
- Lifecycle: Source archive removes retrieval eligibility immediately

### `media_assets` · org
- Fields: `name:string!,mime:string!,size:int!,blobKey:string!,rights:object,altText:string,tags:string[],usageRefs:ref[]`
- Indexes: `orgId+checksum;orgId+tags`
- Lifecycle: Private upload first;publish derivatives only after rights approval

### `design_profiles` · site
- Fields: `tokens:object,componentMappings:object,version:int,status:draft|approved,approvedBy:ref?`
- Indexes: `orgId+websiteId+version unique`
- Lifecycle: Immutable approved versions

### `templates` · site
- Fields: `name:string!,contentType:enum,blocks:object[],designVersion:int,status:enum,version:int`
- Indexes: `orgId+websiteId+name+version unique`
- Lifecycle: Approved mappings immutable;referenced version retained

### `keywords` · site
- Fields: `query:string!,locale:string!,country:string!,device:enum!,intent:enum,volume:int?,difficulty:number?,source:string,measuredAt:date?`
- Indexes: `orgId+websiteId+query+locale+country+device unique`
- Lifecycle: Metrics nullable;append measurements rather than overwrite history

### `topic_clusters` · site
- Fields: `name:string!,keywordIds:ref[],pillarContentId:ref?,status:enum`
- Indexes: `orgId+websiteId+name`
- Lifecycle: Archive and preserve member history

### `opportunities` · site
- Fields: `title:string!,keywordIds:ref[],score:number?,scoreVersion:string,status:enum,evidenceIds:ref[],strategyId:ref?`
- Indexes: `orgId+websiteId+status+score`
- Lifecycle: Link conversion idempotently;no duplicate strategy

### `research_runs` · site
- Fields: `objective:string!,scope:object,status:jobState,budgetMinor:int,costMinor:int,evidence:object[]`
- Indexes: `orgId+websiteId+createdAt`
- Lifecycle: Retain input/output hashes;raw provider retention respects license

### `goals` · site
- Fields: `metric:enum!,baseline:number!,target:number!,startAt:date!,endAt:date!,ownerId:ref!`
- Indexes: `orgId+websiteId+endAt`
- Lifecycle: Version target changes;preserve measurement definitions

### `strategies` · site
- Fields: `name:string!,goalIds:ref[],opportunityIds:ref[],assumptions:string[],status:enum,approvedVersion:int?`
- Indexes: `orgId+websiteId+status`
- Lifecycle: Archive;approval requires matching current version

### `recommendations` · site
- Fields: `title:string!,rationale:string,evidenceIds:ref[],impact:number,effort:enum,status:enum,taskId:ref?`
- Indexes: `orgId+websiteId+status`
- Lifecycle: Conversion idempotent

### `tasks` · org
- Fields: `websiteId:ref?,title:string!,ownerId:ref?,dueAt:date?,priority:enum,status:taskState,dependencies:ref[],linkedEntity:object`
- Indexes: `orgId+ownerId+status+dueAt`
- Lifecycle: Cancel rather than delete completed history

### `calendar_items` · org
- Fields: `websiteId:ref?,entityType:enum!,entityId:ref!,startAt:date!,endAt:date?,timezone:string!`
- Indexes: `orgId+startAt;orgId+entityType+entityId unique`
- Lifecycle: Derived event upsert;deleting task cancels item

### `briefs` · site
- Fields: `title:string!,objective:string,outline:object[],claims:ref[],keywordIds:ref[],status:enum`
- Indexes: `orgId+websiteId+status`
- Lifecycle: Version before draft generation

### `content_items` · site
- Fields: `title:string!,slug:string!,type:enum!,status:contentState,currentVersion:int!,publishedVersion:int?,remoteId:string?,liveUrl:string?,ownerId:ref`
- Indexes: `orgId+websiteId+slug unique;orgId+websiteId+remoteId partial unique`
- Lifecycle: Archive not remote delete;remote deletion separate privileged workflow

### `content_versions` · site
- Fields: `contentId:ref!,version:int!,blocks:object[],seo:object,claimIds:ref[],mediaIds:ref[],inputHash:string!,authorId:ref`
- Indexes: `orgId+contentId+version unique`
- Lifecycle: Immutable;restore creates new version

### `content_approvals` · site
- Fields: `contentId:ref!,version:int!,reviewerId:ref!,decision:enum!,reason:string,policyVersion:int`
- Indexes: `orgId+contentId+version+reviewerId unique`
- Lifecycle: Immutable decision;changed content invalidates eligibility

### `publish_jobs` · site
- Fields: `contentId:ref!,approvedVersion:int!,idempotencyKey:string!,status:jobState,steps:object[],remoteId:string?,attempt:int`
- Indexes: `orgId+websiteId+idempotencyKey unique`
- Lifecycle: Reconcile uncertain outcome before repeat create

### `seo_issues` · site
- Fields: `urlId:ref!,rule:string!,severity:enum!,status:enum!,evidence:object,lastSeenAt:date`
- Indexes: `orgId+websiteId+urlId+rule unique`
- Lifecycle: Resolve with recheck evidence;ignore has reason/expiry

### `sitemaps` · site
- Fields: `url:string!,status:enum,urlCount:int,lastFetchedAt:date?,error:string?`
- Indexes: `orgId+websiteId+url unique`
- Lifecycle: Validate host and XML limits

### `index_status` · site
- Fields: `urlId:ref!,localIndexability:enum,engineState:enum,source:string!,observedAt:date!,evidence:object`
- Indexes: `orgId+websiteId+urlId+source+observedAt unique`
- Lifecycle: Append observations;unknown and stale explicit

### `rankings` · site
- Fields: `keywordId:ref!,url:string?,rank:int?,country:string,device:enum,provider:string,observedAt:date!`
- Indexes: `orgId+websiteId+keywordId+country+device+observedAt unique`
- Lifecycle: Daily snapshots;provider license retention

### `backlinks` · site
- Fields: `sourceUrl:string!,targetUrl:string!,anchor:string,follow:boolean,status:enum,observedAt:date`
- Indexes: `orgId+websiteId+sourceUrl+targetUrl unique`
- Lifecycle: V2;retain loss events

### `authority_opportunities` · site
- Fields: `domain:string!,campaignId:ref?,contactId:ref?,relevance:number,status:enum,ownerId:ref?`
- Indexes: `orgId+websiteId+domain+campaignId unique`
- Lifecycle: V2;PII permission and suppression rules

### `outreach_records` · site
- Fields: `prospectId:ref!,subject:string,body:string,status:enum,approvedVersion:int?,providerMessageId:string?`
- Indexes: `orgId+providerMessageId partial unique`
- Lifecycle: V2;log sends;retain opt-outs separately

### `contacts` · org
- Fields: `name:string!,email:string?,phone:string?,companyId:ref?,consent:object,mergedInto:ref?`
- Indexes: `orgId+email partial exists unique`
- Lifecycle: PII encrypted at rest;merge aliases retained

### `companies` · org
- Fields: `name:string!,domain:string?,industry:string,size:enum,ownerId:ref?`
- Indexes: `orgId+domain partial exists unique`
- Lifecycle: Merge preserves deal and contact links

### `leads` · site
- Fields: `contactId:ref!,companyId:ref?,status:leadState!,ownerId:ref?,source:object,score:int,valueMinor:int?,currency:string,lostReason:string?,closedAt:date?`
- Indexes: `orgId+websiteId+ownerId+status+createdAt;orgId+submissionId partial unique`
- Lifecycle: V1 lead is one sales opportunity;contact may have multiple leads;won events immutable, reopening records reversal

### `lead_activities` · org
- Fields: `leadId:ref!,type:enum!,body:string,actorId:ref?,occurredAt:date!`
- Indexes: `orgId+leadId+occurredAt`
- Lifecycle: Append-only notes/calls/status events;PII redaction workflow

### `follow_ups` · org
- Fields: `leadId:ref!,ownerId:ref!,dueAt:date!,nextAction:string!,status:enum`
- Indexes: `orgId+ownerId+status+dueAt`
- Lifecycle: Complete/snooze audited

### `pipelines` · org
- Fields: `name:string!,stages:object[],version:int,isDefault:boolean`
- Indexes: `orgId+name unique`
- Lifecycle: Canonical V1 stages;custom stages V2

### `forms` · site
- Fields: `name:string!,publicKey:string!,fields:object[],allowedOrigins:string[],consentText:string,status:enum`
- Indexes: `publicKey unique`
- Lifecycle: Public key identifies schema, not privileged API access

### `analytics_events` · site
- Fields: `eventId:string!,event:string!,occurredAt:date!,anonymousId:string?,sessionId:string?,consent:object,dimensions:object`
- Indexes: `orgId+websiteId+eventId unique;occurredAt TTL configurable`
- Lifecycle: Default raw 90 days;no identity joining without consent

### `conversion_events` · site
- Fields: `eventId:string!,type:enum!,leadId:ref?,contentId:ref?,valueMinor:int?,currency:string?,occurredAt:date!`
- Indexes: `orgId+websiteId+eventId unique`
- Lifecycle: Business retention 365 days;deletion request may anonymize

### `analytics_daily` · site
- Fields: `date:date!,provider:string!,dimensionsHash:string!,metrics:object,coverage:object`
- Indexes: `orgId+websiteId+date+provider+dimensionsHash unique`
- Lifecycle: Idempotent daily upsert;365-day defaults

### `reports` · org
- Fields: `websiteId:ref?,name:string!,filters:object,sections:object[],status:jobState,blobKey:string?,snapshotAt:date`
- Indexes: `orgId+createdAt`
- Lifecycle: Private download with current permissions;expire artifact after 30 days

### `agent_runs` · site
- Fields: `agent:string!,inputHash:string!,policyVersion:int,status:jobState,budgetMinor:int,costMinor:int,model:string`
- Indexes: `orgId+websiteId+createdAt`
- Lifecycle: Store evidence and rationale;redact sensitive prompts

### `agent_actions` · org
- Fields: `runId:ref!,actionType:enum!,inputHash:string!,status:enum,approvalId:ref?,idempotencyKey:string!`
- Indexes: `orgId+idempotencyKey unique`
- Lifecycle: Policy/permission/approval revalidated at execution

### `notifications` · org
- Fields: `userId:ref!,eventKey:string!,entity:object,readAt:date?,priority:enum`
- Indexes: `orgId+userId+eventKey unique`
- Lifecycle: 90 days;read checks entity access

### `audit_logs` · org
- Fields: `actorId:ref!,action:string!,entityType:string!,entityId:ref!,before:object?,after:object?,requestId:string!,occurredAt:date!`
- Indexes: `orgId+occurredAt+_id;orgId+entityId`
- Lifecycle: 365-day default;append-only service permission;redact secrets

### `subscriptions` · org
- Fields: `provider:string,customerId:string,status:enum,planId:string,periodEnd:date`
- Indexes: `orgId unique;provider+customerId partial unique`
- Lifecycle: Webhook is authority;retain invoice/legal records per configured policy

### `usage_records` · org
- Fields: `meter:string!,quantity:number!,eventKey:string!,period:string!,reservationState:enum`
- Indexes: `orgId+eventKey unique;orgId+period+meter`
- Lifecycle: Reserve before spending;settle/release once

### `webhook_events` · global service
- Fields: `provider:string!,externalEventId:string!,status:enum,payloadHash:string,processedAt:date?`
- Indexes: `provider+externalEventId unique`
- Lifecycle: Redacted payload;retry processing idempotent

### `outbox` · org
- Fields: `eventKey:string!,type:string!,payload:object,status:pending|sent|failed,attempt:int,nextAt:date`
- Indexes: `orgId+eventKey unique;status+nextAt`
- Lifecycle: Transactional write with business change;worker delivers after commit

## Module boundaries and dependency flow
Auth → Organizations/RBAC → Websites → Brand/Media → Research → Strategy → Content/Design → Publishing → SEO → CRM → Analytics → Agents → Billing. Each NestJS module owns its writes; other modules use services or transactional outbox events. Start modular monolith; Redis/BullMQ workers separate crawling, publishing and AI. Never publish inside an HTTP transaction.

## API convention
`/api/v1/auth/*`, `/api/v1/organizations`, and `/api/v1/organizations/:orgId/<resource>`. Responses return resource objects or `{items,nextCursor}`. Errors `{error:{code,message,requestId,details?}}`. 201 create; 200 update; 202 queued; 204 delete/logout; 400 malformed; 401 session; 403 role; 404 tenant-qualified missing; 409 version/duplicate/transition; 422 fields; 429 throttle; 503 dependency. All writes validate strict bodies; PATCH includes version. Status transitions have dedicated action endpoints. Idempotency keys for job creation/form capture/billing; scoped by org/action and hashed input, changed input with same key gives 409. See foundation-api.openapi.json for executable initial contract; screen catalog specifies future endpoint needs.

## Authentication and membership workflow
Register validates email/password → scrypt hash → user insert → opaque random session token returned only in HttpOnly cookie; store only SHA256 token hash. Login runs password comparison even for unknown account → generic failure or new session. Logout removes current server session and expires cookie. Seven-day expiry; no token in localStorage. Origin allowlist and required application header prevent browser CSRF, including login. SameSite Lax cookie in same-site production; reverse proxy `/api` for cross-origin deployment rather than weakening to unrestricted cookies. Helmet, bounded JSON and auth throttling. Password reset/email verification endpoints remain gated on email provider; no fake email success state.
Organization create → org+Owner membership+audit one transaction. List scoped by active membership. Switch changes selected org ID and clears queries; access checked on every call. Invite creates hashed one-time token and link (manual copy initially, no automatic sending); matching signed-in email accepts atomically; 7-day expiry. Owner can grant Admin; Admin can only grant operational roles. Transfer owner updates both memberships and audit atomically. Membership removal takes effect on next request; historical audits retain actor ID.

## Website workflow
Create normalized bare domain → generate random DNS TXT token → unverified. UI shows `_growth-os.<domain>` record and value. Verify performs DNS TXT lookup outside write transaction, then conditional update matching original version/token; mismatch cannot verify changed domain. No HTTP crawling until verified. Domain edit clears verifiedAt and rotates token. Archive blocks crawl/publish; does not delete history. Crawler M2 next: public DNS/IP checks including redirects and IPv6, DNS rebinding defenses, robots respected, same-host bounds, max 100 URLs default, 2 concurrent per domain, 1 request/sec, 10-second timeout, 2-MB HTML cap, content hash dedupe. Separate worker writes inventory and evidence, then queues technical/design analysis. Discovery is not ownership verification.

## WordPress integration contract (M6)
V1 supports Gutenberg core blocks/basic HTML plus explicit template mapping. Do not assume Elementor/custom theme components are editable. Admin supplies HTTPS URL and scoped application password into encrypted server secret store; test identity and post/media capabilities before Connected. Map title/slug/content/excerpt/featured_media/categories/tags; SEO plugin fields only when provider exposes registered REST meta. Missing plugin fields show Unsupported, not Saved. Draft/live are separate versions. Queue key org+site+content+approvedVersion+operation. Upload each media checksum once and store remote ID. Check remote modified/content hash against last sync; conflicting direct edits pause for compare/choose/merge. After timeout search/reconcile via stored mapping/job marker before create; never blind retry. Verify returned URL/status; enqueue SEO checks. Schedule in OS UTC queue, with timezone display and current approval check. Live mutation uses explicit publish permission. Revoke secret on disconnect. Fixtures cover remote 401,429,5xx,partial media success,duplicate job,remote conflict and lost response after create.

## Google Search Console and GA4 contracts (M7/M9)
OAuth state nonce is single-use, session+org bound with PKCE where supported. Encrypt refresh token; minimum read scopes. Fetch and let admin choose only accessible properties. Persist property ID and timezone. Daily pull with pagination/checkpoints; re-fetch last 7 days for late data and idempotent daily upserts. Respect provider quotas, Retry-After and max attempts; display freshThrough and partial coverage. GSC URL inspection requires property authorization, records exact source/time, never infers indexed from HTTP 200. GA4 dimensions/metrics compatibility validated; consent and privacy thresholds surfaced. No invented visits/leads on disconnection. Unknown source and unconsented users remain unlinked. UI currently does not connect accounts.

## Scores and analytics V1 definitions
Opportunity score: rule v1 = 0.40 business relevance + 0.25 intent fit + 0.20 feasible effort + 0.15 observed demand percentile, each 0–100. If demand absent, score withheld until reviewed; show available component values. No opaque precision. Lead score v1: explicit fit 0–40 + declared buying intent 0–40 + consented engagement 0–20, capped 100; missing engagement contributes 0 with coverage shown. Health = 100 minus severity-weighted failing checks / total possible weights ×100, only for measured rules; show coverage, rule version and crawl date. Growth Score not enabled until its components and minimum coverage validated.
Qualified rate = leads ever qualified / valid non-spam leads in creation cohort. Win rate = won / (won+lost) for outcome-period cohort, not all leads. Conversion = unique converting eligible sessions / eligible sessions, null for zero denominator. First/last known consented touch within 30 days before lead creation; unknown gets unattributed. V1 lead equals deal opportunity; multiple leads may share contact; won value stored per opportunity with immutable close event. Reopening records reversal so revenue not double counted. Money never aggregated across currencies without recorded dated FX rate. No forecasts in V1. UTC storage, organization-zone reporting; GA4 property timezone difference labelled.

## Operational gates / proposed SLOs
Foundation API p95 <500 ms for bounded reads and <1 s writes excluding auth hashing; 99.5% monthly API target. Auth 10 requests/min/IP initially; production add shared Redis account+IP throttle and trusted-proxy configuration. Jobs 3 bounded attempts then dead-letter with manual inspect/retry. Application request IDs, structured redacted logs and Sentry. Atlas encrypted backups daily, 30-day retention target; RPO 24h/RTO 4h validated in restore drill. AI budget defaults disabled until explicit org limit; no unbounded automatic work. API credentials rotate; least-privileged DB credentials, no browser database connection. Retention defaults above are engineering proposals pending jurisdiction/customer policy. Production launch requires email verification/reset, shared throttle, backups/restore, monitoring, vulnerability scan, load tests, and external end-to-end acceptance. Hosting currently has no Atlas URI or Node backend service configured.

## Sources for implementation semantics
- NestJS MongoDB integration: https://docs.nestjs.com/techniques/mongodb
- NestJS authorization: https://docs.nestjs.com/security/authorization
- Mongoose 8 transactions: https://mongoosejs.com/docs/8.x/docs/transactions.html
These support implementation choices; product behavior derives from the attached roadmap and PRD.
