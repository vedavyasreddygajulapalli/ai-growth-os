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
} from "../src/database";
import { createApp } from "../src/app";
let repl: MongoMemoryReplSet, app: any, base: string;
process.env.NODE_ENV = "test";
process.env.APP_ORIGINS = "http://localhost:3000";
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
  r = await call("/auth/register", "POST", {
    name: "Other Tenant",
    email: "other@example.com",
    password: "Other Passphrase 123!",
  });
  outsider = r.cookie;
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
