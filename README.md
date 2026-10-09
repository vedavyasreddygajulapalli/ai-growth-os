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
Requires Node 22+ and MongoDB replica set (Atlas or local). The API deliberately refuses to run without MongoDB; it has no in-memory fallback. A standalone MongoDB server without replica-set transactions is not sufficient.

1. `npm ci --prefix backend`
2. Copy `backend/.env.example` to `backend/.env`, then set a restricted `MONGODB_URI`. Do not commit credentials.
3. `npm run build --prefix backend`
4. In `backend/`, run `node --env-file=.env dist/main.js`.
5. In another terminal: `npm ci --prefix web`, `npm run sync-ui --prefix web`, then `npm run dev --prefix web`.
6. Open `http://localhost:3000`, choose **Open workspace**, register, create a workspace, add a website. Invite links are manual-share; no email is sent.
7. `npm test --prefix backend` runs tests against a temporary real MongoDB replica set. It downloads the MongoDB binary on first run and requires a host that permits running MongoDB/listening sockets.

Next.js proxies `/api/*` to the trusted `API_INTERNAL_URL` (default `http://127.0.0.1:4000`). Use same-origin proxying in production so session cookies remain HttpOnly, Secure, SameSite=Lax. Backend checks exact `APP_ORIGINS` plus `X-Growth-Client`. Do not enable arbitrary CORS or put Atlas connection strings in public variables.

## Deployment
Deploy `web/` to the roadmap's frontend host and `backend/` to a Node service, with Atlas replica set. Configure `MONGODB_URI`, `APP_ORIGINS`, `NODE_ENV=production`, `PORT`; bootstrap indexes under a migration/release job (`INIT_INDEXES=true` only for first bootstrap). Set frontend server-side `API_INTERNAL_URL` to the backend service. Current Sites-hosted static preview intentionally sets `apiEnabled:false` because no MongoDB/Node backend service has been configured there. Never change this flag to imply a connection that does not exist.

Do not mark M1 complete until real database tests pass in the deployment environment, email verification/password reset are delivered, and production security/operations gates in the specification are complete. M2 crawling, subsequent modules, external integrations, automated AI and billing have specifications but are not implemented in this increment.
