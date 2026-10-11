export function crawlSettings(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.CRAWLER_EXECUTION_MODE;
  if (mode && !["embedded", "dedicated"].includes(mode)) throw Error("Invalid CRAWLER_EXECUTION_MODE");
  const mapped = mode === "dedicated" ? "external" : mode;
  if (mapped && env.CRAWLER_EXECUTION && mapped !== env.CRAWLER_EXECUTION) throw Error("Conflicting crawler execution settings");
  const execution = mapped || env.CRAWLER_EXECUTION || "external";
  if (!["external", "embedded"].includes(execution)) throw Error("Invalid CRAWLER_EXECUTION");
  const embedded = execution === "embedded";
  if (embedded && env.CRAWLER_RENDER_JS === "true") throw Error("Embedded crawler cannot render JavaScript");
  if (env.CRAWLER_ENABLED === "true" && !env.REDIS_URL) throw Error("REDIS_URL required for enabled crawler");
  return { execution, maxPages: embedded ? 20 : 500, defaultPages: embedded ? 20 : 100,
    concurrency: embedded ? 1 : 2, maxSitemaps: embedded ? 5 : 20,
    maxDurationMs: embedded ? 180000 : 3600000, renderJs: !embedded && env.CRAWLER_RENDER_JS === "true" };
}
