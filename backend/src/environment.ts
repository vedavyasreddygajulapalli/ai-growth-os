export function positiveInteger(value: string | undefined, fallback: number, max: number) {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error("Invalid numeric environment setting");
  return Number(value);
}
export function validateEnvironment(env: NodeJS.ProcessEnv = process.env) {
  positiveInteger(env.PORT, 4000, 65535);
  positiveInteger(env.AUDIT_EXPORT_LIMIT, 1000, 10000);
  if (env.AUDIT_RETENTION_DAYS) positiveInteger(env.AUDIT_RETENTION_DAYS, 365, 3650);
  if (env.RATE_LIMIT_STORE && !["memory", "redis"].includes(env.RATE_LIMIT_STORE)) throw Error("Invalid RATE_LIMIT_STORE");
  if (env.RATE_LIMIT_STORE === "redis" && !env.REDIS_URL) throw Error("REDIS_URL required for shared rate limiting");
  if (env.REDIS_URL && !/^rediss?:\/\//.test(env.REDIS_URL)) throw Error("Invalid REDIS_URL");
  if (env.NODE_ENV !== "production") return;
  if (!env.MONGODB_URI || !/^mongodb(?:\+srv)?:\/\//.test(env.MONGODB_URI)) throw Error("MONGODB_URI required");
  const origins = (env.APP_ORIGINS || "").split(",").map(s => s.trim());
  for (const origin of [...origins, env.PUBLIC_APP_URL || ""]) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw Error("Production origins must be exact HTTPS origins");
  }
  if (!origins.includes(env.PUBLIC_APP_URL!)) throw Error("PUBLIC_APP_URL must be an allowed origin");
  if (env.TRUST_PROXY === "true" || /^\d+$/.test(env.TRUST_PROXY || "")) throw Error("Use explicit trusted proxy IPs/subnets, not all proxies or hop counts");
}
