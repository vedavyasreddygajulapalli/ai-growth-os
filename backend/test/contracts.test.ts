import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parse,
  websiteDto,
  orgDto,
  registerDto,
  websitePatchDto,
  pageQuery,
} from "../src/contracts";
import {
  assignable,
  hashPassword,
  checkPassword,
  cookieOptions,
} from "../src/security";
import { Website, Membership, Session } from "../src/database";
test("domain validation canonicalizes origin and rejects unsafe or ambiguous destinations", () => {
  assert.equal(
    parse(websiteDto, {
      name: "Acme",
      domain: "https://EXAMPLE.com/",
      cmsType: "WordPress",
    }).domain,
    "example.com",
  );
  for (const domain of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com:443/path",
    "127.0.0.1",
    "localhost",
    "example.internal",
    "https://example.com?x=1",
  ])
    assert.throws(() =>
      parse(websiteDto, { name: "Acme", domain, cmsType: "WordPress" }),
    );
});
test("strict DTO validation rejects injected tenant, invalid zone/currency and stale-version omissions", () => {
  assert.throws(() =>
    parse(orgDto, { name: "Acme", timezone: "Invalid", currency: "INR" }),
  );
  assert.throws(() =>
    parse(orgDto, { name: "Acme", timezone: "UTC", currency: "XYZ" }),
  );
  assert.throws(() =>
    parse(websiteDto, {
      name: "Acme",
      domain: "example.com",
      cmsType: "Other",
      orgId: "forged",
    }),
  );
  assert.throws(() => parse(websitePatchDto, { name: "Changed" }));
  assert.throws(() => pageQuery({ limit: 100000 }));
  assert.throws(() =>
    parse(registerDto, {
      name: "Person",
      email: "person@example.com",
      password: "short",
    }),
  );
});
test("hierarchy cannot grant Owner or let Admin grant Admin", () => {
  assert.throws(() => assignable("Admin", "Admin"));
  assert.throws(() => assignable("Owner", "Owner"));
  assert.doesNotThrow(() => assignable("Owner", "Admin"));
  assert.doesNotThrow(() => assignable("Admin", "Viewer"));
});
test("password hash is salted and only correct password matches", async () => {
  const a = await hashPassword("my long password 123"),
    b = await hashPassword("my long password 123");
  assert.notEqual(a, b);
  assert.equal(await checkPassword("my long password 123", a), true);
  assert.equal(await checkPassword("incorrect password", a), false);
  assert.equal(cookieOptions().httpOnly, true);
  assert.equal(cookieOptions().sameSite, "lax");
});
test("Mongo schemas declare tenant uniqueness, one owner, expiring sessions", () => {
  assert.ok(
    Website.schema
      .indexes()
      .some(([k, o]) => k.orgId === 1 && k.domain === 1 && o.unique),
  );
  assert.ok(
    Membership.schema
      .indexes()
      .some(
        ([k, o]) =>
          k.orgId === 1 &&
          o.unique &&
          o.partialFilterExpression?.role === "Owner",
      ),
  );
  assert.ok(
    Session.schema
      .indexes()
      .some(([k, o]) => k.expiresAt === 1 && o.expireAfterSeconds === 0),
  );
});

// Written for the deferred acceptance pass.
import { auditPage, auditFilter } from "../src/audit-query";
test("audit filters reject tenant overrides, operators, malformed IDs and reversed dates", () => {
  for (const query of [{ orgId: "forged" }, { actorId: { $ne: null } }, { action: ".*" },
    { actorId: "bad-id" }, { from: "2026-10-11T00:00:00Z", to: "2026-10-10T00:00:00Z" },
    { from: "not-a-date" }, { limit: 101 }]) assert.throws(() => auditPage(query));
  const parsed = auditPage({ action: "website.updated", from: "2026-10-10T00:00:00Z", to: "2026-10-10T00:00:00.001Z", limit: "5" });
  const filter = auditFilter("trusted-org", parsed.filters);
  assert.equal(filter.orgId, "trusted-org");
  assert.equal(filter.action, "website.updated");
  assert.equal(parsed.page.limit, 5);
  assert.equal(filter.occurredAt?.$gte?.toISOString(), "2026-10-10T00:00:00.000Z");
});
