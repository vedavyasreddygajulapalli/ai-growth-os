import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import {
  connectDatabase,
  initializeIndexes,
  Audit,
  Website,
  Invitation,
  Session,
  User,
  AuthToken,
  EmailCooldown,
  SecurityEvent,
} from "../src/database";
import { setTestEmailTransport, AccountEmail } from "../src/email";
import { digest } from "../src/security";
import { createApp } from "../src/app";
let repl: MongoMemoryReplSet, app: any, base: string;
process.env.NODE_ENV = "test";
process.env.APP_ORIGINS = "http://localhost:3000";
const messages: AccountEmail[] = [];
setTestEmailTransport(async message => { messages.push(message); });
function deliveredToken(email: string, kind: string) {
  const msg = messages.filter(m => m.to === email && m.text.includes(`?${kind}=`)).at(-1);
  assert.ok(msg, "email delivered to test transport");
  return msg.text.match(new RegExp(`\\?${kind}=([a-f0-9]{64})`))![1];
}
async function verifyEmail(cookie: string, email: string) {
  assert.equal((await call("/auth/email-verification", "POST", {}, cookie)).status, 202);
  const token = deliveredToken(email, "verify");
  assert.equal((await call("/auth/email-verification/complete", "POST", { token })).status, 200);
  return token;
}
let owner = "",
  viewer = "",
  outsider = "",
  orgId = "",
  siteId = "",
  siteVersion = 0;
async function call(
  path: string,
  method = "GET",
  body?: any,
  cookie = "",
  extra: Record<string, string> = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://localhost:3000",
      "X-Growth-Client": "web",
      "Content-Type": "application/json",
      Cookie: cookie,
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: r.status,
    data: r.status === 204 ? null : await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0] || "",
  };
}
before(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.24" },
  });
  await connectDatabase(repl.getUri());
  await initializeIndexes();
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = (await app.getUrl()) + "/api/v1";
});
after(async () => {
  await app?.close();
  await mongoose.disconnect();
  await repl?.stop();
});
test("register uses real MongoDB, HttpOnly session and sanitized response", async () => {
  const r = await call("/auth/register", "POST", {
    name: "Owner Test",
    email: "OWNER@example.com",
    password: "Strong Passphrase 123!",
  });
  assert.equal(r.status, 201);
  owner = r.cookie;
  assert.ok(owner);
  assert.equal(r.data.email, "owner@example.com");
  assert.equal(r.data.passwordHash, undefined);
  assert.equal(await Session.countDocuments(), 1);
  assert.equal(r.data.authVersion, undefined);
  assert.equal((await call("/organizations", "GET", undefined, owner)).status, 403);
  const token = await verifyEmail(owner, "owner@example.com");
  assert.equal((await call("/auth/email-verification/complete", "POST", { token })).status, 409);
});
test("unauthenticated and CSRF requests denied; validation rejects unknown keys", async () => {
  assert.equal((await call("/organizations")).status, 401);
  assert.equal(
    (
      await call(
        "/organizations",
        "POST",
        { name: "Xyz", timezone: "Asia/Kolkata", currency: "INR" },
        owner,
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "/organizations",
        "POST",
        {
          name: "Xyz",
          timezone: "Asia/Kolkata",
          currency: "INR",
          role: "Owner",
        },
        owner,
      )
    ).status,
    422,
  );
});
test("create organization atomically persists owner and audit", async () => {
  const r = await call(
    "/organizations",
    "POST",
    { name: "Real Workspace", timezone: "Asia/Kolkata", currency: "INR" },
    owner,
  );
  assert.equal(r.status, 201);
  orgId = r.data._id;
  assert.equal(
    (await call("/organizations", "GET", undefined, owner)).data.items[0].role,
    "Owner",
  );
  assert.equal(
    await Audit.countDocuments({ orgId, action: "organization.created" }),
    1,
  );
});
test("website create, duplicate rejection and version concurrency", async () => {
  const r = await call(
    `/organizations/${orgId}/websites`,
    "POST",
    { name: "Company", domain: "https://EXAMPLE.com/", cmsType: "WordPress" },
    owner,
  );
  assert.equal(r.status, 201);
  siteId = r.data._id;
  assert.equal(r.data.domain, "example.com");
  assert.equal(r.data.verificationStatus, "unverified");
  assert.equal(r.data.verificationToken, undefined);
  const duplicate = await call(
    `/organizations/${orgId}/websites`,
    "POST",
    { name: "Company", domain: "example.com", cmsType: "Other" },
    owner,
  );
  assert.equal(duplicate.status, 409);
  const u = await call(
    `/organizations/${orgId}/websites/${siteId}`,
    "PATCH",
    { name: "Renamed", version: 0 },
    owner,
  );
  assert.equal(u.status, 200);
  siteVersion = u.data.version;
  assert.equal(
    (
      await call(
        `/organizations/${orgId}/websites/${siteId}`,
        "PATCH",
        { name: "Stale overwrite", version: 0 },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(
    await Audit.countDocuments({ orgId, action: "website.created" }),
    1,
  );
});
test("invitation acceptance is email bound, one-time and role enforced", async () => {
  let r = await call("/auth/register", "POST", {
    name: "Viewer Test",
    email: "viewer@example.com",
    password: "Viewer Passphrase 123!",
  });
  viewer = r.cookie;
  await verifyEmail(viewer, "viewer@example.com");
  r = await call("/auth/register", "POST", {
    name: "Other Tenant",
    email: "other@example.com",
    password: "Other Passphrase 123!",
  });
  outsider = r.cookie;
  await verifyEmail(outsider, "other@example.com");
  const invite = await call(
    `/organizations/${orgId}/invitations`,
    "POST",
    { email: "viewer@example.com", role: "Viewer" },
    owner,
  );
  assert.equal(invite.status, 201);
  assert.ok(invite.data.token);
  assert.equal(
    (
      await call(
        "/invitations/accept",
        "POST",
        { token: invite.data.token },
        outsider,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/invitations/accept",
        "POST",
        { token: invite.data.token },
        viewer,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await call(
        "/invitations/accept",
        "POST",
        { token: invite.data.token },
        viewer,
      )
    ).status,
    409,
  );
  assert.equal(
    (await call(`/organizations/${orgId}/websites`, "GET", undefined, viewer))
      .status,
    200,
  );
  assert.equal(
    (
      await call(
        `/organizations/${orgId}/websites`,
        "POST",
        { name: "Blocked", domain: "another.com", cmsType: "Other" },
        viewer,
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(`/organizations/${orgId}/audit-logs`, "GET", undefined, viewer))
      .status,
    403,
  );
});
test("cross-tenant ID access never leaks website data", async () => {
  assert.equal(
    (
      await call(
        `/organizations/${orgId}/websites/${siteId}`,
        "GET",
        undefined,
        outsider,
      )
    ).status,
    404,
  );
  const other = await call(
    "/organizations",
    "POST",
    { name: "Other Company", timezone: "UTC", currency: "USD" },
    outsider,
  );
  assert.equal(
    (
      await call(
        `/organizations/${other.data._id}/websites/${siteId}`,
        "GET",
        undefined,
        outsider,
      )
    ).status,
    404,
  );
});
test("domain changes invalidate verification; audit redacts verification secrets", async () => {
  await Website.updateOne(
    { _id: siteId },
    { $set: { verificationStatus: "verified", verifiedAt: new Date() } },
  );
  const r = await call(
    `/organizations/${orgId}/websites/${siteId}`,
    "PATCH",
    { domain: "new-example.com", version: siteVersion },
    owner,
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.verificationStatus, "unverified");
  const audits = await call(
    `/organizations/${orgId}/audit-logs`,
    "GET",
    undefined,
    owner,
  );
  assert.equal(
    JSON.stringify(audits.data).includes("verificationToken"),
    false,
  );
  assert.equal(JSON.stringify(audits.data).includes("tokenHash"), false);
});
test("owner protection, removed memberships immediately lose access", async () => {
  const members = (
    await call(`/organizations/${orgId}/memberships`, "GET", undefined, owner)
  ).data.items;
  const own = members.find((m: any) => m.role === "Owner");
  const view = members.find((m: any) => m.role === "Viewer");
  assert.equal(
    (
      await call(
        `/organizations/${orgId}/memberships/${own._id}`,
        "DELETE",
        undefined,
        owner,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/organizations/${orgId}/memberships/${view._id}`,
        "DELETE",
        undefined,
        owner,
      )
    ).status,
    204,
  );
  assert.equal(
    (await call(`/organizations/${orgId}/websites`, "GET", undefined, viewer))
      .status,
    404,
  );
});
test("logout revokes server session immediately", async () => {
  assert.equal((await call("/auth/logout", "POST", {}, owner)).status, 204);
  assert.equal((await call("/auth/me", "GET", undefined, owner)).status, 401);
});

test("session list is private and revoking another user's session is rejected", async () => {
  const a = await call("/auth/sessions", "GET", undefined, viewer);
  const b = await call("/auth/sessions", "GET", undefined, outsider);
  assert.equal(a.status, 200);
  assert.equal(a.data.items.length, 1);
  assert.equal(a.data.items[0].current, true);
  assert.equal(a.data.items[0].tokenHash, undefined);
  assert.equal((await call(`/auth/sessions/${b.data.items[0]._id}`, "DELETE", undefined, viewer)).status, 404);
  assert.equal((await call("/auth/me", "GET", undefined, outsider)).status, 200);
});
test("profile updates validate versions and reject forged privilege fields", async () => {
  const me = (await call("/auth/me", "GET", undefined, outsider)).data;
  assert.equal((await call("/auth/account", "PATCH", { name: "Updated Name", version: me.version }, outsider)).status, 200);
  assert.equal((await call("/auth/account", "PATCH", { name: "Stale Name", version: me.version }, outsider)).status, 409);
  assert.equal((await call("/auth/account", "PATCH", { name: "Injected", version: me.version, status: "admin" }, outsider)).status, 422);
});
test("forgot password is generic; tokens are hashed, expire and are purpose bound", async () => {
  const known = await call("/auth/password-reset", "POST", { email: "viewer@example.com" });
  const unknown = await call("/auth/password-reset", "POST", { email: "absent@example.com" });
  assert.equal(known.status, 202);
  assert.deepEqual(known.data, unknown.data);
  assert.equal(known.data.token, undefined);
  const token = deliveredToken("viewer@example.com", "reset");
  const stored = await AuthToken.findOne({ tokenHash: digest(token) }).select("+tokenHash");
  assert.ok(stored);
  assert.notEqual(stored.tokenHash, token);
  assert.equal((await call("/auth/email-verification/complete", "POST", { token })).status, 409);
  await AuthToken.updateOne({ _id: stored._id }, { $set: { expiresAt: new Date(0) } });
  assert.equal((await call("/auth/password-reset/complete", "POST", { token, newPassword: "Replacement Password 123!" })).status, 409);
  await AuthToken.deleteOne({ _id: stored._id });
  await EmailCooldown.deleteOne({ _id: `${stored.userId}:reset` });
});
test("password reset consumes once under concurrency and revokes all sessions", async () => {
  const login = await call("/auth/login", "POST", { email: "viewer@example.com", password: "Viewer Passphrase 123!" });
  assert.equal(login.status, 200);
  await call("/auth/password-reset", "POST", { email: "viewer@example.com" });
  const token = deliveredToken("viewer@example.com", "reset");
  const results = await Promise.all([1, 2].map(() => call("/auth/password-reset/complete", "POST", { token, newPassword: "Replacement Password 123!" })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await call("/auth/me", "GET", undefined, viewer)).status, 401);
  assert.equal((await call("/auth/me", "GET", undefined, login.cookie)).status, 401);
  assert.equal((await call("/auth/login", "POST", { email: "viewer@example.com", password: "Viewer Passphrase 123!" })).status, 401);
  const fresh = await call("/auth/login", "POST", { email: "viewer@example.com", password: "Replacement Password 123!" });
  assert.equal(fresh.status, 200);
  viewer = fresh.cookie;
  const events = await call("/auth/security-events", "GET", undefined, viewer);
  assert.ok(events.data.items.some((e: any) => e.action === "password.reset"));
  assert.equal(JSON.stringify(events.data).includes(token), false);
  const other = await User.findOne({ email: "other@example.com" });
  assert.ok(events.data.items.every((e: any) => e.userId !== String(other!._id)));
});
test("password change requires current password and invalidates outstanding reset tokens", async () => {
  assert.equal((await call("/auth/password", "POST", { currentPassword: "wrong", newPassword: "Changed Password 123!" }, outsider)).status, 403);
  assert.equal((await call("/auth/me", "GET", undefined, outsider)).status, 200);
  await call("/auth/password-reset", "POST", { email: "other@example.com" });
  const token = deliveredToken("other@example.com", "reset");
  assert.equal((await call("/auth/password", "POST", { currentPassword: "Other Passphrase 123!", newPassword: "Changed Password 123!" }, outsider)).status, 200);
  assert.equal((await call("/auth/me", "GET", undefined, outsider)).status, 401);
  assert.equal((await call("/auth/password-reset/complete", "POST", { token, newPassword: "Replay Password 123!" })).status, 409);
});
test("logout all invalidates stale-version sessions issued concurrently", async () => {
  const user = await User.findOne({ email: "viewer@example.com" });
  assert.equal((await call("/auth/logout-all", "POST", {}, viewer)).status, 204);
  await Session.create({ userId: user!._id, tokenHash: digest("stale-race"), authVersion: user!.authVersion, expiresAt: new Date(Date.now() + 60000) });
  assert.equal((await call("/auth/me", "GET", undefined, "growth_session=stale-race")).status, 401);
});
test("missing email provider fails explicitly and does not create reset tokens", async () => {
  setTestEmailTransport(undefined);
  const before = await AuthToken.countDocuments();
  assert.equal((await call("/auth/password-reset", "POST", { email: "viewer@example.com" })).status, 503);
  assert.equal(await AuthToken.countDocuments(), before);
});
test("ownership transfer preserves exactly one owner and rejects former-owner retries", async () => {
  const signed = await call("/auth/login", "POST", { email: "owner@example.com", password: "Strong Passphrase 123!" });
  const ownerCookie = signed.cookie;
  const otherLogin = await call("/auth/login", "POST", { email: "other@example.com", password: "Changed Password 123!" });
  const inv = await call(`/organizations/${orgId}/invitations`, "POST", { email: "other@example.com", role: "Admin" }, ownerCookie);
  assert.equal(inv.status, 201);
  assert.equal((await call("/invitations/accept", "POST", { token: inv.data.token }, otherLogin.cookie)).status, 201);
  const members = (await call(`/organizations/${orgId}/memberships`, "GET", undefined, ownerCookie)).data.items;
  const previous = members.find((m: any) => m.role === "Owner");
  const target = members.find((m: any) => m.user.email === "other@example.com");
  const transfer = await call(`/organizations/${orgId}/transfer`, "POST", { membershipId: target._id, version: previous.version }, ownerCookie);
  assert.equal(transfer.status, 201, JSON.stringify(transfer.data));
  const after = (await call(`/organizations/${orgId}/memberships`, "GET", undefined, otherLogin.cookie)).data.items;
  assert.equal(after.filter((m: any) => m.role === "Owner").length, 1);
  assert.equal(after.find((m: any) => m._id === target._id).role, "Owner");
  assert.equal((await call(`/organizations/${orgId}/transfer`, "POST", { membershipId: target._id, version: previous.version }, ownerCookie)).status, 403);
  assert.equal((await call(`/organizations/${orgId}/memberships/${target._id}`, "DELETE", undefined, ownerCookie)).status, 403);
});
