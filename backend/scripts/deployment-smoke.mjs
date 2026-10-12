#!/usr/bin/env node
const input = process.argv.find((arg) => arg.startsWith("--url="))?.slice(6)
  ?? (process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : undefined)
  ?? process.env.SMOKE_BASE_URL;

if (!input) {
  console.error("Usage: npm run smoke:deployment -- --url https://your-app.example");
  process.exit(2);
}

let base;
try {
  base = new URL(input);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new Error();
  base.pathname = base.pathname.replace(/\/+$/, "");
} catch {
  console.error("Provide a valid HTTPS application origin or path without credentials, query, or fragment.");
  process.exit(2);
}

const checks = [
  { name: "web home", path: "/", content: "text/html" },
  { name: "API liveness", path: "/api/v1/health/live", json: true },
  { name: "API readiness", path: "/api/v1/health/ready", json: true, ready: true },
];
let failed = false;

for (const check of checks) {
  try {
    const response = await fetch(new URL(`${base.pathname}${check.path}`, base.origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: { accept: check.json ? "application/json" : check.content },
    });
    const requestId = response.headers.get("x-request-id");
    const cacheControl = response.headers.get("cache-control") || "";
    let okay = response.status === 200;
    if (check.json) {
      const contentType = response.headers.get("content-type") || "";
      okay &&= contentType.includes("application/json") && Boolean(requestId) && /no-store/i.test(cacheControl);
      const body = await response.json().catch(() => null);
      okay &&= body?.status === (check.ready ? "ready" : "alive");
      if (check.ready && body?.crawler && body.crawler.ready !== true) okay = false;
    } else {
      okay &&= (response.headers.get("content-type") || "").includes(check.content);
      await response.body?.cancel();
    }
    console.log(`${okay ? "PASS" : "FAIL"} ${check.name} — HTTP ${response.status}${requestId ? ` · request ${requestId}` : ""}`);
    if (!okay) failed = true;
  } catch (error) {
    const code = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause
      ? ` (${String(error.cause.code)})`
      : "";
    console.log(`FAIL ${check.name} — network or timeout error${code}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("Deployment smoke checks passed. This read-only probe does not verify authenticated workflows or external providers.");
