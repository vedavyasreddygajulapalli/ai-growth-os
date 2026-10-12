import { test } from "node:test";
import nodemailer from "nodemailer";
import assert from "node:assert/strict";
import { validateEnvironment } from "../src/environment";
import { RedisRateLimitStore } from "../src/rate-limit";
import { emailConfigured, emailTransport, sendAccountEmail, setTestEmailTransport, smtpOptions } from "../src/email";
import { auditFilter } from "../src/audit-query";
test("production configuration rejects wildcard origins, unsafe proxies and missing Redis", () => {
  const good = { NODE_ENV: "production", MONGODB_URI: "mongodb://localhost/db", APP_ORIGINS: "https://app.example", PUBLIC_APP_URL: "https://app.example" };
  assert.doesNotThrow(() => validateEnvironment(good));
  for (const bad of [{ APP_ORIGINS: "*" }, { PUBLIC_APP_URL: "https://other.example" }, { TRUST_PROXY: "true" }, { RATE_LIMIT_STORE: "redis" }, { AUDIT_EXPORT_LIMIT: "0" }, { DEV_SHOW_VERIFICATION_OTP: "true" }]) assert.throws(() => validateEnvironment({ ...good, ...bad }));
  const filter = auditFilter("tenant", { search: "a.*[b]" });
  assert.equal(new RegExp(filter.$or![0].action.$regex).test("a.*[b]"), true);
  assert.equal(new RegExp(filter.$or![0].action.$regex).test("anythingb"), false);
});
test("SMTP configuration selects authenticated STARTTLS without exposing credentials", () => {
  const env = { EMAIL_TRANSPORT: "smtp", EMAIL_FROM: "App <app@example.com>", PUBLIC_APP_URL: "http://localhost:3000", SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "app@example.com", SMTP_PASS: "app-password" };
  assert.equal(emailTransport(env), "smtp");
  assert.equal(emailConfigured(env), true);
  const options = smtpOptions(env);
  assert.equal(options.host, "smtp.gmail.com");
  assert.equal(options.port, 587);
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.deepEqual(options.auth, { user: "app@example.com", pass: "app-password" });
  assert.equal(emailConfigured({ ...env, SMTP_PASS: "" }), false);
});
test("Resend sends expected payload and rejects provider errors without exposing secrets", async () => {
  const oldFetch = global.fetch, previous = { ...process.env };
  process.env.NODE_ENV = "test"; process.env.EMAIL_TRANSPORT = "resend"; process.env.RESEND_API_KEY = " key "; process.env.EMAIL_FROM = " App <onboarding@resend.dev> "; process.env.PUBLIC_APP_URL = "https://app.example";
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


test("SMTP transport is closed after provider rejection without leaking its error", async () => {
  const previous = { ...process.env }, original = nodemailer.createTransport;
  let closed = false;
  process.env.NODE_ENV = "test";
  process.env.EMAIL_TRANSPORT = "smtp";
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "sender@example.com";
  process.env.SMTP_PASS = "test-only";
  process.env.EMAIL_FROM = "sender@example.com";
  process.env.PUBLIC_APP_URL = "https://app.example";
  setTestEmailTransport(undefined);
  try {
    (nodemailer as any).createTransport = () => ({ sendMail: async () => { throw Error("private smtp details"); }, close: () => { closed = true; } });
    await assert.rejects(sendAccountEmail({ to: "recipient@example.com", subject: "Test", text: "Test", key: "test" }), (e: any) => e.getStatus() === 503 && !JSON.stringify(e).includes("private smtp details"));
    assert.equal(closed, true);
  } finally {
    nodemailer.createTransport = original;
    process.env = previous;
  }
});
