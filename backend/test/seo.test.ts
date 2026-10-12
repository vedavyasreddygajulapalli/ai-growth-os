import { test } from "node:test";
import assert from "node:assert/strict";
import { providerAvailability, seoProviderCatalog } from "../src/seo/providers";

test("SEO provider catalog is explicit and defaults to disconnected without fabricated metrics", () => {
  assert.deepEqual(seoProviderCatalog.map(item => item.key), ["search_console", "rankings", "ai_visibility"]);
  assert.equal(providerAvailability("search_console", new Set()), "disconnected");
  assert.equal(providerAvailability("rankings", new Set()), "disconnected");
  assert.equal(providerAvailability("ai_visibility", new Set()), "disconnected");
});

test("a registered adapter requests authorization and is not reported connected", () => {
  assert.equal(providerAvailability("search_console", new Set(["search_console"])), "authorization_required");
});
