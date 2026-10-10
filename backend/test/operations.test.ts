import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEnvironment } from "../src/environment";
import { RedisRateLimitStore } from "../src/rate-limit";
import { sendAccountEmail, setTestEmailTransport } from "../src/email";
import { auditFilter } from "../src/audit-query";
test("production configuration rejects wildcard origins, unsafe proxies and missing Redis", () => {
  const good = { NODE_ENV: "production", MONGODB_URI: "mongodb://localhost/db", APP_ORIGINS: "https://app.example", PUBLIC_APP_URL: "https://app.example" };
  assert.doesNotThrow(() => validateEnvironment(good));
  for (const bad of [{ APP_ORIGINS: "*" }, { PUBLIC_APP_URL: "https://other.example" }, { TRUST_PROXY: "true" }, { RATE_LIMIT_STORE: "redis" }, { AUDIT_EXPORT_LIMIT: "0" }]) assert.throws(() => validateEnvironment({ ...good, ...bad }));
  const filter = auditFilter("tenant", { search: "a.*[b]" });
  assert.equal(new RegExp(filter.$or![0].action.$regex).test("a.*[b]"), true);
  assert.equal(new RegExp(filter.$or![0].action.$regex).test("anythingb"), false);
});
test("Resend sends expected payload and rejects provider errors without exposing secrets", async () => {
  const oldFetch = global.fetch, previous = { ...process.env };
  process.env.NODE_ENV = "test"; process.env.RESEND_API_KEY = " key "; process.env.EMAIL_FROM = " App <onboarding@resend.dev> "; process.env.PUBLIC_APP_URL = "https://app.example";
  setTestEmailTransport(undefined);
  try {
    global.fetch = async (_url, opts) => {
      assert.equal((opts!.headers as any).Authorization, "Bearer key");
      assert.equal(JSON.parse(opts!.body as string).from, "App <onboarding@resend.dev>");
      return new Response("{}", { status: 200 });
    };
    const message = { to: "recipient@example.com", subject: "Verify", text: "private-token", key: "unique-key" };
    await sendAccountEmail(message);
    global.fetch = async () => new Response("null", { status: 422 });
    await assert.rejects(sendAccountEmail(message), /Email could not be sent/);
    global.fetch = async () => { throw new Error("secret provider detail"); };
    await assert.rejects(sendAccountEmail(message), /Email could not be sent/);
  } finally { global.fetch = oldFetch; for (const k of Object.keys(process.env)) if (!(k in previous)) delete process.env[k]; Object.assign(process.env, previous); }
});
test("two instances share Redis throttles and recover after expiry", { skip: !process.env.REDIS_TEST_URL }, async () => {
  const a = new RedisRateLimitStore(process.env.REDIS_TEST_URL!), b = new RedisRateLimitStore(process.env.REDIS_TEST_URL!);
  try {
    await Promise.all([a.ready(), b.ready()]);
    const key = `test-${Date.now()}`;
    assert.equal((await a.increment(key, 100, 1, 100, "test")).isBlocked, false);
    assert.equal((await b.increment(key, 100, 1, 100, "test")).isBlocked, true);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal((await a.increment(key, 100, 1, 100, "test")).isBlocked, false);
  } finally { a.close(); b.close(); }
});
