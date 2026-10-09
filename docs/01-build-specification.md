# AI Growth OS — Development Specification V1

Prepared 9 October 2026. Source order: attached Next Development Steps roadmap (stack, order, V1 boundary), Master PRD v1 (feature detail), approved AI Growth OS dashboard source commit 966ed884f0dae70aa3288b6df3fa3b3c4d467731 (visual system). Existing implementation is static HTML/CSS/JavaScript with local demonstration data, not an existing Next.js backend. Preserve its emerald palette, sidebar, spacing, card/table/form/drawer patterns and ten modules during migration. No redesign is authorized.

## Scope and resolved decisions
- Organization and workspace are the same tenant in V1. Membership may differ by organization; multiple websites per tenant. Agency access uses separate memberships; hierarchy, aggregate agency dashboards and white-label are V2.
- Keep all ten navigation modules. Authority, AI Visibility observations/citations and predictive simulations have V2/Later states, not simulated production numbers.
- AI provider adapter may support user-requested drafting in M3–M5. Autonomous orchestration waits until M10 after manual paths pass.
- Canonical roles: Owner, Admin, Marketing Manager, SEO Manager, Content Writer, Sales User, Viewer. Undefined Strategy role maps to Marketing Manager. Owner/Admin inherit operational privileges except separation-of-duty approvals and Owner-only controls.
- Later roadmap status shorthand does not remove detailed PRD states: retain Brief, Attempted, Spam, Sync Error, Cancelled. Persist machine-readable canonical keys and map display labels consistently.
- Explicit implementation boundary in this increment: M1 core authentication/workspaces/memberships/roles/audit and M2 website CRUD plus DNS verification. Crawler and further modules follow only after these are connected and accepted. Provider/email/billing configuration and operational hardening remain deployment gates.

## Shared screen contract (inherited by EVERY screen below)
Each screen entry is a complete contract when combined with this section and its collection definitions. Listed field names are exact API keys. Required form fields are nonempty unless marked optional by API schema; IDs are ObjectId strings and references must resolve within the request tenant. Text defaults: name/title 2–160, summary 0–2,000, body 0–100,000; reject unknown keys and object-valued text. All times are ISO-8601 UTC; input/display uses organization IANA timezone. Currency is ISO 4217 and amounts integer minor units. URLs allow HTTPS only for external integrations; never execute user-provided URLs without public IP/redirect checks.

Lists use cursor pagination (default 25, maximum 100), stable createdAt/_id ordering; search by title/name/domain; explicit filters listed for each screen. Sort options must be whitelisted. Detail drawers load by tenant-qualified ID; edit forms use optimistic version. Primary create/edit actions open the approved modal/drawer; destructive actions state affected record and dependencies. Preserve unsaved input after failure, trap focus, close with Escape, restore invoking focus, label controls and support keyboard activation. Mobile retains sidebar drawer and horizontally scrollable tables; never hide essential status/action without alternative.

States: initial skeleton; empty source with a permission-aware Add/Connect action; filtered-empty with Clear filters; inline 422 field errors; 401 return to sign-in; 403 no write control and server denial; 404 record unavailable without leaking existence; 409 preserve draft and offer reload/compare; 429 show Retry-After; 503 retain inputs and Retry; disconnected show source, last successful sync and reconnect for authorized role; stale badge with observedAt; unknown never represented as zero. Drawers have separate loading/error state. Submit buttons disable while pending; no success toast before server confirmation. Abort/cancel requests and clear entity state when changing organization or website.

Read permissions: all module-readable roles inside tenant, except Sales limited to own leads/activities and revenue Owner/Admin; never rely on hidden buttons. Writes follow the matrix below. AI defaults Manual/Assisted: generation creates proposals, never publishes or sends. Every write records actor, org, entity, action, UTC time, requestId and redacted before/after snapshot; cross-module actions store correlationId and idempotencyKey.

Universal acceptance for EVERY entry: authenticated happy path persists and reloads; unauthenticated denied; unauthorized role denied even direct API call; other-tenant ID returns no record; invalid fields rejected; stale version fails without loss; duplicate/replayed operation not duplicated; empty/loading/error/disconnected states render; responsive keyboard flow works; audit exists exactly once per committed mutation; source and freshness are visible for external metrics. Screen-specific criteria below add to these requirements. These criteria are specifications, not claims that future modules have passed testing.

## Permission matrix
| Capability | Owner | Admin | Marketing | SEO | Writer | Sales | Viewer |
|---|---|---|---|---|---|---|---|
| View operational modules | Yes | Yes | Yes | Yes | Yes | Own CRM + summary | Yes |
| Organization settings / websites / integrations | Yes | Yes | No | No | No | No | No |
| Invite operational roles | Yes | Yes | No | No | No | No | No |
| Grant/revoke Admin, ownership transfer | Yes | No | No | No | No | No | No |
| Brand facts/products/media edit | Yes | Yes | Yes | No | Draft only | No | No |
| Verify claims / approve strategy | Yes | Yes | Yes | No | No | No | No |
| Research create/review | Yes | Yes | Yes | Yes | No | No | No |
| Convert opportunity to plan | Yes | Yes | Yes | No | No | No | No |
| Content draft | Yes | Yes | Yes | Yes | Yes | No | No |
| Approve / publish content | Yes | Yes | Yes | SEO review only | No | No | No |
| SEO safe fixes / audit | Yes | Yes | Yes | Yes | No | No | No |
| URL/canonical/noindex destructive approval | Yes | Yes | No | No | No | No | No |
| CRM manage | Yes | Yes | Read/source | No | No | Assigned only | Read non-PII summary |
| Revenue / billing | Yes | Revenue | No | No | No | Own deal values | No |
| Audit log | Yes | Yes | No | No | No | No | No |

Owner is one membership per organization. Transfer is transactional; Admin cannot promote themselves or edit Owner/Admin. Removing a member immediately invalidates organization permissions, even with an existing session. No self-approval of consequential content/claim actions by default; small teams must explicitly configure an Owner-approved exception recorded in audit.

## State machines
- Content: Idea → Brief → Draft → In Review → Approved → Scheduled/Publishing → Published. Review → Draft on changes; approved edits → Draft; published edits create Update Pending version. Publishing → Sync Error on failure; retry requires reconciliation and valid approval. Any non-running state may archive with privilege; no arbitrary client transition.
- Tasks: Backlog → Planned → In Progress → Review → Completed; active states ↔ Blocked with reason; active → Cancelled; reopen Completed → Planned with audit.
- Knowledge: Draft → Processing → Needs Review → Verified; reviewer may Restricted; validUntil passes → Expired; non-running → Archived. Reprocessing does not silently reverify.
- Leads: New → Attempted/Contacted → Qualified → Meeting → Proposal → Negotiation → Won/Lost/Not Relevant; direct forward skips allowed with reason; Spam from pre-closed states; reopening closed → Contacted preserves prior close event.
- Jobs: Queued → Running → Awaiting Approval/Completed/Failed; Failed → Retrying → Running, maximum 3 attempts with exponential backoff/jitter; cancelled cannot execute. Waiting Approval is display alias of Awaiting Approval.
- Integration: Disconnected → Action Required → Connected; Connected → Warning/Expired/Disabled; revoke tokens on disconnect. No credentials supplied means Disconnected.
- Website: active/archived independent from unverified/verified. Domain change resets DNS verification and invalidates connections and crawl permission.

## Milestone gates
M1 Foundation → M2 Website/crawler → M3 Brand/media → M4 Research/Strategy → M5 Content/design → M6 WordPress → M7 SEO/indexing → M8 CRM → M9 Analytics → M10 Assisted agents → M11 Billing/usage → M12 hardening. Each gate requires real persisted data, failure-path tests, tenant/role checks, audit evidence and UI loading/error states. Do not call the overall product production-ready before the full PRD acceptance loop is tested with configured external accounts.

## Screen contracts


## Overview

### S001 · Executive Dashboard [V1]
Purpose: manage/inspect executive dashboard within the selected workspace and website.

- Data/fields & filters: `period,websiteId,comparison`.
- Cards/table/detail data: `organicSessions,qualifiedLeads,wonValue,health,sourceFreshness`.
- Actions/drawers/modals: Refresh;open metric;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET dashboard`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Analytics ingested;missing sources show unavailable, never sample metrics. Plus all universal acceptance checks.

### S002 · Growth Inbox [V1]
Purpose: manage/inspect growth inbox within the selected workspace and website.

- Data/fields & filters: `type,priority,assignee,status`.
- Cards/table/detail data: `title,entityLink,priority,owner,dueAt,status`.
- Actions/drawers/modals: Acknowledge;snooze;open linked entity.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET inbox;PATCH inbox/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Acknowledgement audited;role filter removes inaccessible entities. Plus all universal acceptance checks.

### S003 · Decision Center [V1]
Purpose: manage/inspect decision center within the selected workspace and website.

- Data/fields & filters: `actionId,version,decision,reason`.
- Cards/table/detail data: `rationale,impact,cost,affectedIds,requiredPermission`.
- Actions/drawers/modals: Approve;reject;request changes.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET decisions;POST decisions/:id/decision`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Approval binds action input hash;changed inputs invalidate approval. Plus all universal acceptance checks.

### S004 · AI Activity [V1]
Purpose: manage/inspect ai activity within the selected workspace and website.

- Data/fields & filters: `agent,status,from,to`.
- Cards/table/detail data: `runId,agent,status,cost,startedAt,finishedAt,error`.
- Actions/drawers/modals: Inspect;cancel;retry failed.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET agent-runs;POST agent-runs/:id/retry`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Retry creates linked attempt;completed action cannot run twice. Plus all universal acceptance checks.

### S005 · Goals & Progress [V1]
Purpose: manage/inspect goals & progress within the selected workspace and website.

- Data/fields & filters: `metric,target,baseline,startAt,endAt,ownerId`.
- Cards/table/detail data: `metric,baseline,target,actual,progress,coverage`.
- Actions/drawers/modals: Create;edit;close goal.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST goals;PATCH goals/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Metric denominator and baseline fixed;zero baseline has no fabricated percentage. Plus all universal acceptance checks.

### S006 · Change Analysis [V2]
Purpose: manage/inspect change analysis within the selected workspace and website.

- Data/fields & filters: `metric,period,segments`.
- Cards/table/detail data: `delta,contributingSegments,evidence,confidence`.
- Actions/drawers/modals: Compare;create recommendation.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET change-analysis`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Insufficient data produces explicit unknown attribution. Plus all universal acceptance checks.


## Brand & Knowledge

### S007 · Business Profile [V1]
Purpose: manage/inspect business profile within the selected workspace and website.

- Data/fields & filters: `name,legalName,industry,description,locations[],websiteId`.
- Cards/table/detail data: `name,industry,completeness,updatedBy,updatedAt`.
- Actions/drawers/modals: Edit;save;view history.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/PUT brand-profile`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Name required 2–120;website belongs to workspace. Plus all universal acceptance checks.

### S008 · Products [V1]
Purpose: manage/inspect products within the selected workspace and website.

- Data/fields & filters: `name,description,sku,priceMinor,currency,benefits[],evidenceIds[]`.
- Cards/table/detail data: `name,sku,status,updatedAt`.
- Actions/drawers/modals: Create;edit;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST products;PATCH products/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: SKU unique per workspace;money stored integer minor units. Plus all universal acceptance checks.

### S009 · Services [V1]
Purpose: manage/inspect services within the selected workspace and website.

- Data/fields & filters: `name,description,locations[],benefits[],faq[],evidenceIds[]`.
- Cards/table/detail data: `name,coverage,status`.
- Actions/drawers/modals: Create;edit;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST services;PATCH services/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Used services archive only;linked content remains resolvable. Plus all universal acceptance checks.

### S010 · Audiences [V1]
Purpose: manage/inspect audiences within the selected workspace and website.

- Data/fields & filters: `name,roles[],industries[],problems[],goals[],objections[],stage`.
- Cards/table/detail data: `name,stage,linkedContentCount`.
- Actions/drawers/modals: Create;edit;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST audiences;PATCH audiences/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Invalid buying stage rejected;references scoped to organization. Plus all universal acceptance checks.

### S011 · Competitors [V1]
Purpose: manage/inspect competitors within the selected workspace and website.

- Data/fields & filters: `name,domain,notes,approved`.
- Cards/table/detail data: `name,domain,coverage,approved`.
- Actions/drawers/modals: Add;edit;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST competitors;PATCH competitors/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Normalized domain unique per website;no private-network fetch. Plus all universal acceptance checks.

### S012 · Brand Voice [V1]
Purpose: manage/inspect brand voice within the selected workspace and website.

- Data/fields & filters: `tone[],preferredTerms[],forbiddenTerms[],examples[],language`.
- Cards/table/detail data: `version,updatedAt,updatedBy`.
- Actions/drawers/modals: Edit;preview;save.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/PUT brand-voice`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Version conflict preserves input;new version is used only by subsequent jobs. Plus all universal acceptance checks.

### S013 · Claims & Evidence [V1]
Purpose: manage/inspect claims & evidence within the selected workspace and website.

- Data/fields & filters: `claim,evidenceIds[],validUntil,status,restrictionReason`.
- Cards/table/detail data: `claim,status,evidenceCount,expiresAt`.
- Actions/drawers/modals: Submit;verify;restrict;expire.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST claims;POST claims/:id/transition`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Writer cannot verify own claim;restricted or expired facts excluded from AI. Plus all universal acceptance checks.

### S014 · Proof Library [V1]
Purpose: manage/inspect proof library within the selected workspace and website.

- Data/fields & filters: `title,type,sourceId,mediaId,consentNote,validUntil`.
- Cards/table/detail data: `title,type,status,usageCount`.
- Actions/drawers/modals: Add;edit;archive;inspect usage.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST proofs;PATCH proofs/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Customer proof requires permission record before verified use. Plus all universal acceptance checks.

### S015 · Knowledge Sources [V1]
Purpose: manage/inspect knowledge sources within the selected workspace and website.

- Data/fields & filters: `title,type,url,fileId,manualText,visibility`.
- Cards/table/detail data: `title,type,status,lastProcessedAt,error`.
- Actions/drawers/modals: Upload;import;review facts;reprocess;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST knowledge-sources;POST knowledge-sources/:id/process`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Untrusted source cannot override system rules;archive shows downstream usage. Plus all universal acceptance checks.

### S016 · Memory Health [V1]
Purpose: manage/inspect memory health within the selected workspace and website.

- Data/fields & filters: `websiteId,category,status`.
- Cards/table/detail data: `coverage,staleFacts,missingEvidence,sourceAge`.
- Actions/drawers/modals: Review gap;create task.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET memory-health`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Health rule version shown;unmeasured categories excluded. Plus all universal acceptance checks.

### S017 · Media Library [V1]
Purpose: manage/inspect media library within the selected workspace and website.

- Data/fields & filters: `file,altText,tags[],rightsType,licenseReference,entityIds[]`.
- Cards/table/detail data: `thumbnail,name,mime,size,rights,usageCount`.
- Actions/drawers/modals: Upload;tag;replace;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET media;POST media/upload-intent;POST media/:id/complete`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: MIME/signature and byte limits enforced;in-use media cannot hard-delete. Plus all universal acceptance checks.

### S018 · Design Profile [V1]
Purpose: manage/inspect design profile within the selected workspace and website.

- Data/fields & filters: `colors,fonts,spacing,radii,componentMappings,approvalVersion`.
- Cards/table/detail data: `website,version,status,approvedBy`.
- Actions/drawers/modals: Detect proposal;edit;approve.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/PUT design-profile;POST design-profile/approve`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Discovery never marks inferred tokens approved;website-specific tokens remain distinct. Plus all universal acceptance checks.


## Research

### S019 · Research Overview [V1]
Purpose: manage/inspect research overview within the selected workspace and website.

- Data/fields & filters: `websiteId,period`.
- Cards/table/detail data: `keywordCount,opportunityCount,providerFreshness,coverage`.
- Actions/drawers/modals: Run research;open opportunity.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET research/summary;POST research-runs`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Missing paid provider data stays null, never estimated as measured. Plus all universal acceptance checks.

### S020 · Opportunities [V1]
Purpose: manage/inspect opportunities within the selected workspace and website.

- Data/fields & filters: `title,keywordIds[],intent,relevance,effort,status`.
- Cards/table/detail data: `title,intent,demand,difficulty,score,status`.
- Actions/drawers/modals: Review;accept;reject;watch;send to Strategy.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST opportunities;POST opportunities/:id/plan`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Plan conversion idempotent;Marketing/Admin/Owner only. Plus all universal acceptance checks.

### S021 · Keywords [V1]
Purpose: manage/inspect keywords within the selected workspace and website.

- Data/fields & filters: `query,locale,country,device,intent`.
- Cards/table/detail data: `query,volume,difficulty,position,provider,measuredAt`.
- Actions/drawers/modals: Import;add;tag;track;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST keywords;PATCH keywords/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Uniqueness includes locale/country/device;missing volume not zero. Plus all universal acceptance checks.

### S022 · Topic Clusters [V1]
Purpose: manage/inspect topic clusters within the selected workspace and website.

- Data/fields & filters: `name,keywordIds[],pillarContentId`.
- Cards/table/detail data: `name,keywords,demand,coverage`.
- Actions/drawers/modals: Create;merge;assign pillar.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST topic-clusters;PATCH topic-clusters/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Merge retains source IDs and avoids double-counting demand. Plus all universal acceptance checks.

### S023 · Competitor Intelligence [V1]
Purpose: manage/inspect competitor intelligence within the selected workspace and website.

- Data/fields & filters: `competitorId,period`.
- Cards/table/detail data: `domain,pages,keywordOverlap,observedAt`.
- Actions/drawers/modals: Compare;refresh;open page.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET competitor-intelligence`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Evidence source and timestamp shown for every metric. Plus all universal acceptance checks.

### S024 · Content Gaps [V1]
Purpose: manage/inspect content gaps within the selected workspace and website.

- Data/fields & filters: `competitorIds[],intent,minRelevance`.
- Cards/table/detail data: `topic,competitorCoverage,ownCoverage,evidence`.
- Actions/drawers/modals: Create opportunity;dismiss.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET content-gaps;POST opportunities`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Gap links to observed competing URLs. Plus all universal acceptance checks.

### S025 · Trend Radar [V2]
Purpose: manage/inspect trend radar within the selected workspace and website.

- Data/fields & filters: `topics[],country,period`.
- Cards/table/detail data: `topic,delta,confidence,source`.
- Actions/drawers/modals: Watch;open evidence.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET trends`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Low sample sizes suppress trend significance. Plus all universal acceptance checks.

### S026 · Research Projects [V1]
Purpose: manage/inspect research projects within the selected workspace and website.

- Data/fields & filters: `name,objective,scope,providerBudget`.
- Cards/table/detail data: `name,status,owner,cost,startedAt`.
- Actions/drawers/modals: Create;run;cancel;retry.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST research-runs;POST research-runs/:id/cancel`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Budget reserved before jobs;failed run retains evidence. Plus all universal acceptance checks.


## Strategy & Planning

### S027 · Goals [V1]
Purpose: manage/inspect goals within the selected workspace and website.

- Data/fields & filters: `metric,target,baseline,startAt,endAt,ownerId`.
- Cards/table/detail data: `name,target,actual,owner,dueAt`.
- Actions/drawers/modals: Create;edit;close.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST goals;PATCH goals/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Start before end;targets nonnegative;owner is active member. Plus all universal acceptance checks.

### S028 · Growth Plan [V1]
Purpose: manage/inspect growth plan within the selected workspace and website.

- Data/fields & filters: `name,goalIds[],opportunityIds[],assumptions,budget`.
- Cards/table/detail data: `name,status,impact,effort,approvedBy`.
- Actions/drawers/modals: Draft;propose;approve;activate;cancel.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST strategies;POST strategies/:id/transition`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Only approved plan creates executable task batch. Plus all universal acceptance checks.

### S029 · Recommendations [V1]
Purpose: manage/inspect recommendations within the selected workspace and website.

- Data/fields & filters: `title,rationale,evidenceIds[],impact,effort,dependencies[]`.
- Cards/table/detail data: `title,priority,status,effort,owner`.
- Actions/drawers/modals: Accept;reject;create task.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET recommendations;POST recommendations/:id/accept`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Accept is idempotent and stores created task ID. Plus all universal acceptance checks.

### S030 · Roadmap [V1]
Purpose: manage/inspect roadmap within the selected workspace and website.

- Data/fields & filters: `startAt,endAt,taskIds[],milestone`.
- Cards/table/detail data: `milestone,dates,dependencies,progress`.
- Actions/drawers/modals: Move;reschedule;inspect dependency.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET roadmap;PATCH tasks/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Dependency cycle rejected;completed task dates preserve history. Plus all universal acceptance checks.

### S031 · Tasks [V1]
Purpose: manage/inspect tasks within the selected workspace and website.

- Data/fields & filters: `title,description,ownerId,dueAt,priority,status,linkedEntity`.
- Cards/table/detail data: `title,type,status,owner,dueAt`.
- Actions/drawers/modals: Create;assign;transition;comment.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST tasks;PATCH tasks/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Assignee scoped;blocked requires reason;done has completedAt. Plus all universal acceptance checks.

### S032 · Calendar [V1]
Purpose: manage/inspect calendar within the selected workspace and website.

- Data/fields & filters: `startAt,endAt,type,ownerId,entityId`.
- Cards/table/detail data: `date,title,type,status,owner`.
- Actions/drawers/modals: Open;reschedule;filter.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET calendar;PATCH calendar/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Store UTC, display organization timezone;DST ambiguous times require offset. Plus all universal acceptance checks.

### S033 · Scenarios [Later]
Purpose: manage/inspect scenarios within the selected workspace and website.

- Data/fields & filters: `assumptions,resourceBudget,variant`.
- Cards/table/detail data: `variant,estimatedImpact,range,confidence`.
- Actions/drawers/modals: Compare;save scenario.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST scenarios`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Predictions clearly hypothetical;never represent guaranteed outcomes. Plus all universal acceptance checks.

### S034 · Playbooks [V2]
Purpose: manage/inspect playbooks within the selected workspace and website.

- Data/fields & filters: `name,steps[],dependencies[],version`.
- Cards/table/detail data: `name,steps,version,usage`.
- Actions/drawers/modals: Create;duplicate;apply.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST playbooks;POST playbooks/:id/apply`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Applying creates snapshot;future edits do not mutate active tasks. Plus all universal acceptance checks.


## Content & AI CMS

### S035 · All Content [V1]
Purpose: manage/inspect all content within the selected workspace and website.

- Data/fields & filters: `type,status,ownerId,query,websiteId`.
- Cards/table/detail data: `title,type,status,quality,owner,updatedAt,publishAt`.
- Actions/drawers/modals: Create;open;filter;archive.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST content-items;PATCH content-items/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Stable cursor pagination and tenant/website filters enforced. Plus all universal acceptance checks.

### S036 · Create Content [V1]
Purpose: manage/inspect create content within the selected workspace and website.

- Data/fields & filters: `title,type,slug,briefId,audienceId,keywordIds[],templateId`.
- Cards/table/detail data: `title,type,slug,status`.
- Actions/drawers/modals: Create draft;cancel.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `POST content-items`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Slug unique per website;create request deduplicated by idempotency key. Plus all universal acceptance checks.

### S037 · Briefs [V1]
Purpose: manage/inspect briefs within the selected workspace and website.

- Data/fields & filters: `objective,intent,audienceId,outline[],claims[],cta,keywordIds[],mediaSlots[]`.
- Cards/table/detail data: `title,status,owner,sourceOpportunity`.
- Actions/drawers/modals: Create;edit;request draft.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST briefs;POST briefs/:id/generate`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: AI references verified fact IDs;unsupported claims flagged. Plus all universal acceptance checks.

### S038 · Editor [V1]
Purpose: manage/inspect editor within the selected workspace and website.

- Data/fields & filters: `title,slug,blocks[],seoTitle,metaDescription,schema,mediaIds[],version`.
- Cards/table/detail data: `wordCount,quality,claims,status,saveState`.
- Actions/drawers/modals: Save;preview;rewrite;submit review.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET content-items/:id;PUT content-items/:id;POST content-items/:id/submit`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Sanitize rendered HTML;If-Match conflict never overwrites another editor. Plus all universal acceptance checks.

### S039 · Approvals [V1]
Purpose: manage/inspect approvals within the selected workspace and website.

- Data/fields & filters: `contentId,version,decision,reason`.
- Cards/table/detail data: `title,version,checks,reviewer,status`.
- Actions/drawers/modals: Approve;request changes;reject.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET content-approvals;POST content-items/:id/decision`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Approval bound to immutable version;post-approval edit resets review. Plus all universal acceptance checks.

### S040 · Scheduled [V1]
Purpose: manage/inspect scheduled within the selected workspace and website.

- Data/fields & filters: `publishAt,timezone,approvedVersion`.
- Cards/table/detail data: `title,publishAt,zone,status`.
- Actions/drawers/modals: Schedule;reschedule;cancel.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `POST content-items/:id/schedule`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Past time rejected;worker rechecks membership/approval/connector before execution. Plus all universal acceptance checks.

### S041 · Published [V1]
Purpose: manage/inspect published within the selected workspace and website.

- Data/fields & filters: `websiteId,type,period`.
- Cards/table/detail data: `title,remoteId,liveUrl,publishedAt,syncState`.
- Actions/drawers/modals: View live;create update draft;inspect sync.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET content-items?status=Published;POST content-items/:id/update-draft`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Existing remote ID used for updates;remote conflict requires resolution. Plus all universal acceptance checks.

### S042 · Refresh [V1]
Purpose: manage/inspect refresh within the selected workspace and website.

- Data/fields & filters: `contentId,trigger,evidence,threshold`.
- Cards/table/detail data: `title,decayEvidence,status,lastRefresh`.
- Actions/drawers/modals: Create refresh draft;dismiss.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET refresh-candidates;POST content-items/:id/refresh`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Manual refresh V1;predictive decay V2;published version preserved. Plus all universal acceptance checks.

### S043 · Internal Links [V1]
Purpose: manage/inspect internal links within the selected workspace and website.

- Data/fields & filters: `sourceContentId,targetContentId,anchor,blockId`.
- Cards/table/detail data: `source,target,anchor,status`.
- Actions/drawers/modals: Accept;reject;apply to draft.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET internal-links;POST internal-links/:id/apply`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Target must belong to website;no auto-change to approved/live content. Plus all universal acceptance checks.

### S044 · Version History [V1]
Purpose: manage/inspect version history within the selected workspace and website.

- Data/fields & filters: `contentId,version,compareVersion`.
- Cards/table/detail data: `version,author,reason,createdAt,diff`.
- Actions/drawers/modals: Compare;restore as draft.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET content-items/:id/versions;POST content-items/:id/restore`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Restore creates new version and invalidates prior approval. Plus all universal acceptance checks.

### S045 · Templates & Composer [V1]
Purpose: manage/inspect templates & composer within the selected workspace and website.

- Data/fields & filters: `name,contentType,blocks[],variants,mappings,designVersion`.
- Cards/table/detail data: `name,type,status,version`.
- Actions/drawers/modals: Edit;reorder;preview;approve.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST templates;POST templates/:id/approve`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: WordPress V1 supports approved Gutenberg/basic HTML mapping only. Plus all universal acceptance checks.

### S046 · Publishing & Sync Logs [V1]
Purpose: manage/inspect publishing & sync logs within the selected workspace and website.

- Data/fields & filters: `jobId,attempt,status`.
- Cards/table/detail data: `step,status,remoteId,error,retryAt`.
- Actions/drawers/modals: Inspect;retry;resolve conflict.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET publish-jobs;POST publish-jobs/:id/retry`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Ambiguous remote timeout reconciles external ID before retrying create. Plus all universal acceptance checks.


## SEO & AI Visibility

### S047 · SEO Overview [V1]
Purpose: manage/inspect seo overview within the selected workspace and website.

- Data/fields & filters: `websiteId,period`.
- Cards/table/detail data: `health,indexCoverage,criticalIssues,crawlFreshness`.
- Actions/drawers/modals: Run audit;open issues.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET seo/summary;POST website-crawls`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: No crawl yields no score;display audited URL denominator. Plus all universal acceptance checks.

### S048 · Site Audit [V1]
Purpose: manage/inspect site audit within the selected workspace and website.

- Data/fields & filters: `crawlId,scope,maxUrls`.
- Cards/table/detail data: `crawl,status,checkedUrls,issueCount,startedAt`.
- Actions/drawers/modals: Start;cancel;compare.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET website-crawls;POST website-crawls`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Verified domains only;robots,rate and URL budgets enforced. Plus all universal acceptance checks.

### S049 · Issues [V1]
Purpose: manage/inspect issues within the selected workspace and website.

- Data/fields & filters: `type,severity,status,assignee`.
- Cards/table/detail data: `url,type,severity,status,evidence,lastSeenAt`.
- Actions/drawers/modals: Assign;apply safe fix;ignore;recheck.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET seo-issues;POST seo-issues/:id/transition`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Fix applied differs from resolved;resolve only after recheck evidence. Plus all universal acceptance checks.

### S050 · Indexing [V1]
Purpose: manage/inspect indexing within the selected workspace and website.

- Data/fields & filters: `status,source,priority,checkedBefore`.
- Cards/table/detail data: `url,indexability,engineState,source,checkedAt,reason`.
- Actions/drawers/modals: Inspect;recheck;create task.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET index-status;POST website-urls/:id/inspect`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Local indexability never labelled Google Indexed;unknown/stale states explicit. Plus all universal acceptance checks.

### S051 · Sitemaps [V1]
Purpose: manage/inspect sitemaps within the selected workspace and website.

- Data/fields & filters: `url,type,refreshInterval`.
- Cards/table/detail data: `url,status,urlCount,lastFetchedAt,error`.
- Actions/drawers/modals: Add;fetch;validate.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST sitemaps;POST sitemaps/:id/refresh`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Host scoped;XML entity expansion disabled;canonical indexable URLs only. Plus all universal acceptance checks.

### S052 · Rankings [V1]
Purpose: manage/inspect rankings within the selected workspace and website.

- Data/fields & filters: `keywordId,country,device,dateRange`.
- Cards/table/detail data: `query,url,rank,delta,provider,checkedAt`.
- Actions/drawers/modals: Track;pause;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET rankings;POST ranking-tracks`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: No provider means disconnected;location/device preserved in comparisons. Plus all universal acceptance checks.

### S053 · Search Console [V1]
Purpose: manage/inspect search console within the selected workspace and website.

- Data/fields & filters: `propertyId,query,page,device,country,dateRange`.
- Cards/table/detail data: `clicks,impressions,ctr,position,freshThrough`.
- Actions/drawers/modals: Connect;refresh;filter;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET search-console;POST integrations/:id/sync`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Access checked for selected property;partial dates labelled. Plus all universal acceptance checks.

### S054 · Internal Links Audit [V1]
Purpose: manage/inspect internal links audit within the selected workspace and website.

- Data/fields & filters: `source,target,status`.
- Cards/table/detail data: `source,target,httpStatus,anchor,issue`.
- Actions/drawers/modals: Create task;recheck.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET internal-link-audit`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Crawl evidence distinguishes broken from redirected link. Plus all universal acceptance checks.

### S055 · AI Visibility [V2]
Purpose: manage/inspect ai visibility within the selected workspace and website.

- Data/fields & filters: `promptSet,provider,locale,runDate`.
- Cards/table/detail data: `prompt,brandMention,citation,competitors,sampleCount`.
- Actions/drawers/modals: Run approved prompt set;compare.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET ai-visibility;POST visibility-runs`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Sampled observations labelled;no universal AI ranking claim. Plus all universal acceptance checks.

### S056 · AI Citations [V2]
Purpose: manage/inspect ai citations within the selected workspace and website.

- Data/fields & filters: `provider,prompt,url`.
- Cards/table/detail data: `citation,answerExcerpt,source,observedAt`.
- Actions/drawers/modals: Inspect;create authority task.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET ai-citations`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Store permitted evidence;absent citation is not proof of global absence. Plus all universal acceptance checks.

### S057 · Schema [V1]
Purpose: manage/inspect schema within the selected workspace and website.

- Data/fields & filters: `contentId,type,jsonLd,version`.
- Cards/table/detail data: `url,type,validation,status`.
- Actions/drawers/modals: Validate;save draft;request approval.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/PUT schema;POST schema/validate`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: No rich-result guarantee;invalid schema cannot publish. Plus all universal acceptance checks.


## Authority & PR

### S058 · Authority Overview [V2]
Purpose: manage/inspect authority overview within the selected workspace and website.

- Data/fields & filters: `websiteId,dateRange`.
- Cards/table/detail data: `referringDomains,newLinks,lostLinks,providerFreshness`.
- Actions/drawers/modals: Open gap;create campaign.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET authority/summary`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Unavailable provider data not presented as zero. Plus all universal acceptance checks.

### S059 · Backlinks [V2]
Purpose: manage/inspect backlinks within the selected workspace and website.

- Data/fields & filters: `domain,follow,status`.
- Cards/table/detail data: `source,target,anchor,follow,firstSeen,lastSeen,status`.
- Actions/drawers/modals: Import;verify;monitor.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST backlinks`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Imported metrics keep source/date;verification does not imply endorsement. Plus all universal acceptance checks.

### S060 · Link Gap [V2]
Purpose: manage/inspect link gap within the selected workspace and website.

- Data/fields & filters: `competitorIds[],relevance`.
- Cards/table/detail data: `domain,competitorLinks,ownLinks,relevance`.
- Actions/drawers/modals: Qualify prospect.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET link-gaps;POST authority-opportunities`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Same prospect deduplicated by normalized domain and campaign. Plus all universal acceptance checks.

### S061 · Prospects [V2]
Purpose: manage/inspect prospects within the selected workspace and website.

- Data/fields & filters: `name,domain,contactId,country,relevance,notes`.
- Cards/table/detail data: `domain,contact,relevance,owner,status`.
- Actions/drawers/modals: Add;qualify;reject;assign.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST authority-opportunities;PATCH authority-opportunities/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Personal contact access scoped;no automated message on creation. Plus all universal acceptance checks.

### S062 · Outreach [V2]
Purpose: manage/inspect outreach within the selected workspace and website.

- Data/fields & filters: `prospectId,subject,body,channel,approvedVersion`.
- Cards/table/detail data: `recipient,status,owner,lastContactAt`.
- Actions/drawers/modals: Draft;approve;send;record reply.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST outreach-records;POST outreach-records/:id/send`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Explicit send permission, suppression list,approval and quota checked. Plus all universal acceptance checks.

### S063 · Citations [V2]
Purpose: manage/inspect citations within the selected workspace and website.

- Data/fields & filters: `directory,url,businessName,address,phone,status`.
- Cards/table/detail data: `source,consistency,status,lastVerifiedAt`.
- Actions/drawers/modals: Add;verify;request correction.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST citations`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Observed and expected business details shown separately. Plus all universal acceptance checks.

### S064 · Digital PR [V2]
Purpose: manage/inspect digital pr within the selected workspace and website.

- Data/fields & filters: `campaign,title,assetIds[],pitch,targets[],budget`.
- Cards/table/detail data: `campaign,status,owner,deadline`.
- Actions/drawers/modals: Create;draft pitch;review.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST pr-campaigns`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Campaign creation cannot send outreach. Plus all universal acceptance checks.

### S065 · Authority Score [V2]
Purpose: manage/inspect authority score within the selected workspace and website.

- Data/fields & filters: `websiteId,period`.
- Cards/table/detail data: `relevance,diversity,coverage,score,ruleVersion`.
- Actions/drawers/modals: Inspect methodology;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET authority/score`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Exclude missing inputs and show coverage;no third-party DA equivalence. Plus all universal acceptance checks.


## Leads & CRM

### S066 · Lead Inbox [V1]
Purpose: manage/inspect lead inbox within the selected workspace and website.

- Data/fields & filters: `query,status,ownerId,source,from,to`.
- Cards/table/detail data: `name,company,status,score,owner,source,createdAt`.
- Actions/drawers/modals: Add;assign;qualify;mark spam.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST leads;PATCH leads/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Sales sees assigned records;public capture deduplicates submission ID. Plus all universal acceptance checks.

### S067 · Pipeline [V1]
Purpose: manage/inspect pipeline within the selected workspace and website.

- Data/fields & filters: `pipelineId,ownerId,currency`.
- Cards/table/detail data: `stage,leadCount,dealValue,owner`.
- Actions/drawers/modals: Move stage;open lead;close deal.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET pipelines;POST leads/:id/transition`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Won requires deal value/currency;lost requires reason;currency never summed across units. Plus all universal acceptance checks.

### S068 · Contacts [V1]
Purpose: manage/inspect contacts within the selected workspace and website.

- Data/fields & filters: `name,email,phone,companyId,consent`.
- Cards/table/detail data: `name,email,company,leadCount`.
- Actions/drawers/modals: Create;edit;merge.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST contacts;POST contacts/:id/merge`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Merge retains source IDs and activities;repeat enquiry creates separate lead. Plus all universal acceptance checks.

### S069 · Companies [V1]
Purpose: manage/inspect companies within the selected workspace and website.

- Data/fields & filters: `name,domain,industry,size,ownerId`.
- Cards/table/detail data: `name,domain,contacts,openDeals`.
- Actions/drawers/modals: Create;edit;merge.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST companies;PATCH companies/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Company dedupe by normalized domain per org;private notes not public. Plus all universal acceptance checks.

### S070 · Lead Detail [V1]
Purpose: manage/inspect lead detail within the selected workspace and website.

- Data/fields & filters: `contactId,companyId,interest,ownerId,status,valueMinor,currency,lostReason`.
- Cards/table/detail data: `identity,scoreBreakdown,source,stage,activity`.
- Actions/drawers/modals: Edit;assign;transition;add note;reopen.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET leads/:id;PATCH leads/:id;POST leads/:id/activities`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: All status changes immutable in activity history;reopen keeps prior outcome. Plus all universal acceptance checks.

### S071 · Activities [V1]
Purpose: manage/inspect activities within the selected workspace and website.

- Data/fields & filters: `leadId,type,body,occurredAt`.
- Cards/table/detail data: `type,actor,body,occurredAt`.
- Actions/drawers/modals: Add note;log call/meeting;view.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST lead-activities`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: PII access follows lead;recording a call does not place one. Plus all universal acceptance checks.

### S072 · Follow-ups [V1]
Purpose: manage/inspect follow-ups within the selected workspace and website.

- Data/fields & filters: `leadId,ownerId,dueAt,nextAction,status`.
- Cards/table/detail data: `lead,dueAt,owner,status`.
- Actions/drawers/modals: Schedule;complete;snooze.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST follow-ups;PATCH follow-ups/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Overdue computed in org zone;completion saves actor and time. Plus all universal acceptance checks.

### S073 · Forms [V1]
Purpose: manage/inspect forms within the selected workspace and website.

- Data/fields & filters: `name,fields[],allowedOrigins[],consentText,assignmentRule`.
- Cards/table/detail data: `name,submissions,status`.
- Actions/drawers/modals: Create;preview;publish;disable.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST forms;POST public/forms/:key/submissions`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Rate limit,origin validation,honeypot and schema validation;no API secrets in embed. Plus all universal acceptance checks.

### S074 · Lead Analytics [V1]
Purpose: manage/inspect lead analytics within the selected workspace and website.

- Data/fields & filters: `period,source,ownerId`.
- Cards/table/detail data: `volume,qualificationRate,winRate,responseTime,coverage`.
- Actions/drawers/modals: Filter;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET lead-analytics`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Denominators and cohort dates visible;Sales own-scope aggregation. Plus all universal acceptance checks.


## Analytics & Reports

### S075 · Analytics Overview [V1]
Purpose: manage/inspect analytics overview within the selected workspace and website.

- Data/fields & filters: `dateRange,websiteId,compare`.
- Cards/table/detail data: `sessions,leads,qualified,wonValue,freshness`.
- Actions/drawers/modals: Filter;drill down;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/overview`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Provider gaps shown;no synthetic interpolation. Plus all universal acceptance checks.

### S076 · Traffic [V1]
Purpose: manage/inspect traffic within the selected workspace and website.

- Data/fields & filters: `dateRange,country,device`.
- Cards/table/detail data: `users,sessions,pageviews,engagement,source`.
- Actions/drawers/modals: Filter;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/traffic`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: GA4 consent and threshold restrictions surfaced. Plus all universal acceptance checks.

### S077 · Acquisition [V1]
Purpose: manage/inspect acquisition within the selected workspace and website.

- Data/fields & filters: `dateRange,channel,campaign`.
- Cards/table/detail data: `channel,sessions,leads,conversions`.
- Actions/drawers/modals: Drill down;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/acquisition`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Unknown channel remains unknown;UTM preserved. Plus all universal acceptance checks.

### S078 · Content Performance [V1]
Purpose: manage/inspect content performance within the selected workspace and website.

- Data/fields & filters: `contentId,type,dateRange`.
- Cards/table/detail data: `page,views,leads,rate,assistedValue`.
- Actions/drawers/modals: Open page;create refresh.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/content`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: URL mapping versioned;pageviews not used as sessions denominator. Plus all universal acceptance checks.

### S079 · SEO Analytics [V1]
Purpose: manage/inspect seo analytics within the selected workspace and website.

- Data/fields & filters: `dateRange,query,country,device`.
- Cards/table/detail data: `clicks,impressions,ctr,position,top3,top10,top20`.
- Actions/drawers/modals: Filter;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/seo`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: CTR clicks/impressions;position impression-weighted. Plus all universal acceptance checks.

### S080 · AI Analytics [V2]
Purpose: manage/inspect ai analytics within the selected workspace and website.

- Data/fields & filters: `provider,promptSet,dateRange`.
- Cards/table/detail data: `mentions,citations,referrals,coverage`.
- Actions/drawers/modals: Filter;inspect evidence.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/ai`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: AI referral attribution separate from sampled answer visibility. Plus all universal acceptance checks.

### S081 · Leads Analytics [V1]
Purpose: manage/inspect leads analytics within the selected workspace and website.

- Data/fields & filters: `dateRange,cohort,source`.
- Cards/table/detail data: `leads,qualified,won,lost,responseTime`.
- Actions/drawers/modals: Filter;open cohort.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/leads`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Lead creation cohort clearly distinct from outcome event period. Plus all universal acceptance checks.

### S082 · Conversions [V1]
Purpose: manage/inspect conversions within the selected workspace and website.

- Data/fields & filters: `event,period,contentId`.
- Cards/table/detail data: `event,count,uniqueSessions,rate`.
- Actions/drawers/modals: Define event;filter;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET conversion-events;POST conversion-definitions`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Event ID unique per website;duplicates do not inflate count. Plus all universal acceptance checks.

### S083 · Attribution [V1]
Purpose: manage/inspect attribution within the selected workspace and website.

- Data/fields & filters: `model,lookbackDays,dateRange`.
- Cards/table/detail data: `source,page,lead,creditedValue,coverage`.
- Actions/drawers/modals: Compare first/last touch;inspect journey.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/attribution`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: 30-day V1 window;unconsented sessions not identity-linked;linear V2. Plus all universal acceptance checks.

### S084 · Revenue [V1]
Purpose: manage/inspect revenue within the selected workspace and website.

- Data/fields & filters: `dateRange,currency,ownerId`.
- Cards/table/detail data: `wonValue,pipelineValue,refunds,coverage`.
- Actions/drawers/modals: Filter;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET analytics/revenue`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Owner/Admin only by default;integer money and separate currencies. Plus all universal acceptance checks.

### S085 · Reports [V1]
Purpose: manage/inspect reports within the selected workspace and website.

- Data/fields & filters: `name,sections[],period,timezone,format`.
- Cards/table/detail data: `name,status,createdAt,owner`.
- Actions/drawers/modals: Generate;download;retry.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST reports;POST reports/:id/generate`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Downloads permission-checked;scheduled outbound delivery requires configured recipient consent. Plus all universal acceptance checks.


## Integrations & Settings

### S086 · Organization [V1]
Purpose: manage/inspect organization within the selected workspace and website.

- Data/fields & filters: `name,timezone,currency,version`.
- Cards/table/detail data: `name,timezone,currency,role,updatedAt`.
- Actions/drawers/modals: Create;switch;update.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST organizations;PATCH organizations/:orgId`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Organization equals workspace V1;switch clears previous data/query cache. Plus all universal acceptance checks.

### S087 · Websites [V1]
Purpose: manage/inspect websites within the selected workspace and website.

- Data/fields & filters: `name,domain,cmsType,version`.
- Cards/table/detail data: `name,domain,cmsType,verificationStatus,status`.
- Actions/drawers/modals: Add;edit;archive;request verification;verify DNS.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST websites;PATCH websites/:id;POST websites/:id/verify`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Domain canonicalized;unique per org;verification token required before crawling. Plus all universal acceptance checks.

### S088 · Website Detail & URL Inventory [V1]
Purpose: manage/inspect website detail & url inventory within the selected workspace and website.

- Data/fields & filters: `websiteId,query,status,source`.
- Cards/table/detail data: `url,httpStatus,canonical,indexability,lastCrawledAt`.
- Actions/drawers/modals: Filter;inspect;crawl.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET websites/:id;GET website-urls;POST website-crawls`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Archived website blocks jobs;inventory belongs to selected website. Plus all universal acceptance checks.

### S089 · Integrations [V1]
Purpose: manage/inspect integrations within the selected workspace and website.

- Data/fields & filters: `provider,websiteId,propertyId,permissions`.
- Cards/table/detail data: `provider,status,lastSyncAt,error`.
- Actions/drawers/modals: Connect;test;disconnect;reconnect.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET integrations;POST integrations/:provider/connect;DELETE integrations/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Credentials encrypted;OAuth state single-use/org-bound;WordPress first. Plus all universal acceptance checks.

### S090 · Team [V1]
Purpose: manage/inspect team within the selected workspace and website.

- Data/fields & filters: `email,role,invitationToken`.
- Cards/table/detail data: `name,email,role,status,joinedAt`.
- Actions/drawers/modals: Invite;copy invite link;revoke invite;accept;remove.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET memberships;POST invitations;POST invitations/accept;DELETE memberships/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Admin cannot grant Owner/Admin or edit Owner;single Owner transfer atomic. Plus all universal acceptance checks.

### S091 · Roles [V1]
Purpose: manage/inspect roles within the selected workspace and website.

- Data/fields & filters: `memberId,role,version`.
- Cards/table/detail data: `role,permissions,memberCount`.
- Actions/drawers/modals: View matrix;assign role;transfer ownership.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `PATCH memberships/:id;POST organizations/:id/transfer`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Seven predefined roles;custom roles V2;every check enforced server-side. Plus all universal acceptance checks.

### S092 · AI Settings [V1]
Purpose: manage/inspect ai settings within the selected workspace and website.

- Data/fields & filters: `mode,allowedActions[],maxSpend,maxPages,protectedUrls[]`.
- Cards/table/detail data: `mode,limits,approvalRules`.
- Actions/drawers/modals: Edit;save;view policy history.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/PUT ai-policy`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Manual/Assisted V1;Autopilot later;policy update cannot authorize blocked action. Plus all universal acceptance checks.

### S093 · Notifications [V1]
Purpose: manage/inspect notifications within the selected workspace and website.

- Data/fields & filters: `event,channel,enabled,digestFrequency`.
- Cards/table/detail data: `event,channel,status`.
- Actions/drawers/modals: Update preferences.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/PUT notification-preferences`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: No email sent without provider/verified address;critical in-app remains available. Plus all universal acceptance checks.

### S094 · Usage [V1]
Purpose: manage/inspect usage within the selected workspace and website.

- Data/fields & filters: `period,meter`.
- Cards/table/detail data: `meter,used,limit,resetAt`.
- Actions/drawers/modals: Inspect;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET usage-records`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Usage generated server-side by successful/reserved operations;retries not double-billed. Plus all universal acceptance checks.

### S095 · Billing [V1]
Purpose: manage/inspect billing within the selected workspace and website.

- Data/fields & filters: `planId,billingContact,currency`.
- Cards/table/detail data: `plan,status,invoices,periodEnd`.
- Actions/drawers/modals: Checkout;change plan;download invoice.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET subscription;POST billing/checkout`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Webhook signature and event idempotency required;no client-set paid status. Plus all universal acceptance checks.

### S096 · Audit Logs [V1]
Purpose: manage/inspect audit logs within the selected workspace and website.

- Data/fields & filters: `actorId,action,entityType,from,to,cursor`.
- Cards/table/detail data: `actor,action,entity,time,before,after`.
- Actions/drawers/modals: Filter;inspect;export.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET audit-logs`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Append-only;redact tokens/passwords;every successful foundation mutation atomic with audit. Plus all universal acceptance checks.

### S097 · API & Webhooks [V2]
Purpose: manage/inspect api & webhooks within the selected workspace and website.

- Data/fields & filters: `name,scopes[],expiresAt,url,events[]`.
- Cards/table/detail data: `keyPrefix,status,lastUsed,deliveryStatus`.
- Actions/drawers/modals: Create;rotate;revoke;retry delivery.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST api-keys;GET/POST webhooks`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Hash keys;reveal once;sign deliveries;SSRF protection on callback URLs. Plus all universal acceptance checks.

### S098 · Data Controls [V1]
Purpose: manage/inspect data controls within the selected workspace and website.

- Data/fields & filters: `scope,retention,reason,confirmation`.
- Cards/table/detail data: `exportStatus,deletionStatus,requestedBy`.
- Actions/drawers/modals: Request export;request deletion.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `POST data-requests;GET data-requests`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Owner-only;reauthenticate destructive actions;hold pending approval until retention policy satisfied. Plus all universal acceptance checks.


## Authentication & Shared Shell

### S099 · Sign up [V1]
Purpose: manage/inspect sign up within the selected workspace and website.

- Data/fields & filters: `name,email,password`.
- Cards/table/detail data: `fieldErrors,submitting`.
- Actions/drawers/modals: Register;open sign in.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `POST auth/register`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Email normalized;password 12–128;hash only;duplicate email generic conflict. Plus all universal acceptance checks.

### S100 · Sign in [V1]
Purpose: manage/inspect sign in within the selected workspace and website.

- Data/fields & filters: `email,password`.
- Cards/table/detail data: `fieldErrors,submitting`.
- Actions/drawers/modals: Sign in;open reset.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `POST auth/login`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Generic invalid-credential response;rate limit;HttpOnly expiring session. Plus all universal acceptance checks.

### S101 · Password Reset [V1]
Purpose: manage/inspect password reset within the selected workspace and website.

- Data/fields & filters: `email,token,newPassword`.
- Cards/table/detail data: `requestState,expiry`.
- Actions/drawers/modals: Request link;reset.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `POST auth/password-reset;POST auth/password-reset/complete`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Single-use hashed 30-minute token;all sessions revoked;email provider required. Plus all universal acceptance checks.

### S102 · Workspace Onboarding [V1]
Purpose: manage/inspect workspace onboarding within the selected workspace and website.

- Data/fields & filters: `name,timezone,currency`.
- Cards/table/detail data: `workspaces,roles`.
- Actions/drawers/modals: Create;switch.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET/POST organizations`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Create owner membership and audit in one transaction;zero sample data inserted. Plus all universal acceptance checks.

### S103 · Invitation Acceptance [V1]
Purpose: manage/inspect invitation acceptance within the selected workspace and website.

- Data/fields & filters: `token`.
- Cards/table/detail data: `organization,email,role,expiry`.
- Actions/drawers/modals: Sign in;accept.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `POST invitations/accept`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Only signed-in matching email can accept;expired/revoked token rejected atomically. Plus all universal acceptance checks.

### S104 · Global Search & Notifications [V1]
Purpose: manage/inspect global search & notifications within the selected workspace and website.

- Data/fields & filters: `query,type,cursor`.
- Cards/table/detail data: `entity,title,module,unreadCount`.
- Actions/drawers/modals: Search;open;mark read.
- API needs (under `/api/v1/organizations/:orgId/` unless auth/public): `GET search;GET notifications;PATCH notifications/:id`.
- Status, permissions, empty/error and audit: shared contracts above; phase-disabled features display “Available in a later release”, never invented results.
- Acceptance: Results restricted before search;no cross-org titles/snippets leak. Plus all universal acceptance checks.
