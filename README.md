# AI Growth OS — foundation increment

The approved 10-module visual system is retained. The original static prototype is in `dist/`; the Next.js migration shell in `web/` reuses those exact CSS and layout assets. NestJS/Mongoose backend in `backend/` owns real data. No production records are stored in browser storage; original browser-saved data is explicitly isolated inside Design preview.

## Deliverables
- `docs/01-build-specification.md`: 104 screen/shared-flow contracts, V1/V2/Later decisions, roles, statuses, acceptance criteria.
- `docs/02-data-model-and-workflows.md`: 63 target collections, indexes, retention, module/API workflows, provider and operations contracts.
- `docs/foundation-api.openapi.json`: initial implemented API operations.
- `docs/03-implementation-status.md`: what exists, what was verified, remaining launch gates.
- `web/`: Next.js/TypeScript migration shell; approved UI bridge is transitional. Split remaining legacy sections into typed React components as each module becomes real, without visual redesign.
- `backend/`: NestJS API, validation, Mongoose schemas, transaction/audit services, integration tests.

## Run locally
Requires Node 22+, a MongoDB replica set (Atlas or local), and Redis for crawler jobs and the full integration suite. The API deliberately refuses to run without MongoDB; it has no in-memory fallback. A standalone MongoDB server without replica-set transactions is not sufficient.

1. `npm ci --prefix backend`
2. Copy `backend/.env.example` to `backend/.env`, then set a restricted `MONGODB_URI`. Do not commit credentials.
3. `npm run build --prefix backend`; in `backend/`, run `node --env-file=.env dist/migrate.js` to bootstrap indexes.
4. In `backend/`, run `node --env-file=.env dist/main.js`.
5. In another terminal: `npm ci --prefix web`, `npm run sync-ui --prefix web`, then `npm run dev --prefix web`.
6. Open `http://localhost:3000`, choose **Open workspace**, register, request and complete email verification, create a workspace, add a website. Invite links are manual-share; no email is sent.
7. Start an isolated Redis test service and set `REDIS_TEST_URL` (for example `redis://127.0.0.1:6379`), then run `npm test --prefix backend`. Tests use a temporary real MongoDB replica set plus Redis/BullMQ. MongoDB is downloaded on first run; the host must permit MongoDB and listening sockets. Do not use production Redis for tests.

Next.js proxies `/api/*` to the trusted `API_INTERNAL_URL` (default `http://127.0.0.1:4000`). Use same-origin proxying in production so session cookies remain HttpOnly, Secure, SameSite=Lax. Backend checks exact `APP_ORIGINS` plus `X-Growth-Client`. Do not enable arbitrary CORS or put Atlas connection strings in public variables.

## Account security increment

Email verification, password reset/change, account profile, device sessions, logout-all and account security history are implemented. Configure the server-only email variables in `backend/.env.example` and run `npm run db:migrate --prefix backend` before upgrading an existing database. See `docs/04-account-security-acceptance.md` for exact workflows and deployment gates. Live inbox delivery remains unverified. Render database readiness and index bootstrap were checked on 10 October 2026; full authenticated deployment acceptance remains open.

## Deployment
The existing Render API and web services deploy the Node applications with an Atlas replica set. Configure `MONGODB_URI`, `APP_ORIGINS`, `NODE_ENV=production`, `PORT`; bootstrap indexes under a migration/release job (`INIT_INDEXES=true` only for first bootstrap). Set frontend server-side `API_INTERNAL_URL` to the backend service. The live preview is https://ai-growth-os-web-us4p.onrender.com/ . Choose **Open workspace** for real account workflows. The signed-out design preview is explicitly labeled sample data and does not prove backend completion.

Do not mark M1 complete until real database tests pass in the deployment environment, live email verification/password reset are verified, and production security/operations gates in the specification are complete. M2 crawler code and connected UI are implemented and CI-tested, but live crawler acceptance requires its separate worker and Redis deployment. Subsequent milestones remain planned.

## Foundation hardening
See `docs/06-foundation-operations.md` for Redis rate limiting, environment validation, readiness/liveness, retention/export policies, migrations and backup/restore procedures. CI runs real MongoDB workflows and shared Redis tests. Live email, hosting proxy settings, monitoring and restore rehearsal remain deployment acceptance gates; no production verification bypass exists.

## Website crawler (M2)
The real crawler implementation is in `backend/src/crawler/`. Run `npm run db:migrate --prefix backend`, start a Redis-compatible service with noeviction, then `npm run worker --prefix backend` independently of the API. Configure REDIS_URL and enable CRAWLER_ENABLED only after worker deployment. JavaScript rendering stays disabled until Chromium sandbox/security acceptance. See `docs/07-crawler-acceptance.md` and the optional `render.crawler.yaml`; that blueprint introduces paid resources and has not been applied. Crawl snapshots and current inventory are MongoDB-backed; the UI never seeds fake live crawler records.

## Verified deployment checkpoint
Code commit `49f5c5da2b7cf2c6418bd59cccc1ee4b7c872fab` is live on both existing Render services. Its CI passed 19 unit/UI/operations tests, 22 MongoDB integration tests and both production builds: https://github.com/vedavyasreddygajulapalli/ai-growth-os/actions/runs/38057001660 . Render index migration completed; API readiness and the frontend-proxied readiness endpoint returned HTTP 200. This does not close live email, authenticated browser, DNS, backup/restore or crawler-worker acceptance gates. See the implementation-status document for newer test-only evidence.

## Free crawler testing mode
The existing API can supervise the crawler using `CRAWLER_EXECUTION=embedded`, `CRAWLER_ENABLED=true`, `CRAWLER_RENDER_JS=false` and a private `REDIS_URL`. This profile caps crawls at 20 pages, one concurrent job and five sitemap files. Real results remain in MongoDB; the approved UI is unchanged apart from permitted form values. Free hosting can sleep and free Redis can reset, so queued/interrupted jobs may wait or require retry. Do not use this profile as proof of reliable unattended production crawling. See the free-to-paid migration steps in `docs/07-crawler-acceptance.md`.
