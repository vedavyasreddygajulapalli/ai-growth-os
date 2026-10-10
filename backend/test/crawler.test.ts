import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, publicAddress, sameHost, safeFetch, FetchResult } from "../src/crawler/safe-fetch";
import { robots, sitemap, extract, pageIssues } from "../src/crawler/extract";
test("crawler normalization preserves distinct routes while removing fragments and sorting queries", () => {
  assert.equal(normalizeUrl("/A/?z=2&a=1#x","https://EXAMPLE.com"),"https://example.com/A/?a=1&z=2");
  assert.notEqual(normalizeUrl("https://example.com/a"),normalizeUrl("https://example.com/a/"));
  assert.equal(sameHost("https://evil.example.com/","example.com"),false);
  for(const url of ["file:///etc/passwd","http://user:pass@example.com/","http://example.com:8080","https://example.com./"])assert.throws(()=>normalizeUrl(url));
});
test("SSRF blocks loopback, private, link-local, metadata, multicast and mapped IPv6", async () => {
  for(const ip of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.0.1","169.254.169.254","100.64.0.1","0.0.0.0","224.0.0.1","::1","fc00::1","fe80::1","::ffff:127.0.0.1","2001:db8::1"])assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress("1.1.1.1"),true);
  await assert.rejects(safeFetch("http://127.0.0.1/","127.0.0.1"),/UNSAFE_ADDRESS/);
});
test("robots respects agent groups and sitemap parser rejects entities", () => {
  const r=robots("https://example.com/robots.txt","User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: https://example.com/map.xml");
  assert.equal(r.isAllowed("https://example.com/private","AIGrowthOSBot/1.0"),false);
  assert.equal(r.isAllowed("https://example.com/private/public","AIGrowthOSBot/1.0"),true);
  assert.deepEqual(r.getSitemaps(),["https://example.com/map.xml"]);
  assert.equal(sitemap('<sitemapindex><sitemap><loc>https://example.com/nested.xml</loc></sitemap></sitemapindex>').nested.length,1);
  assert.equal(sitemap('<urlset><url><loc>https://example.com/a</loc><lastmod>2026-10-10</lastmod></url></urlset>').urls[0].lastmod,"2026-10-10");
  assert.throws(()=>sitemap('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><urlset/>'));
});
test("metadata extraction and technical issues use actual HTML and headers", () => {
  const r:FetchResult={url:"https://example.com/",finalUrl:"https://example.com/",statusCode:200,headers:{"content-type":"text/html","x-robots-tag":"noindex"},bytes:200,responseMs:10,redirects:[],body:'<html lang="en"><head><title>Useful page title for testing</title><meta name="description" content="Description"><meta property="og:title" content="OG title"><meta name="twitter:card" content="summary"><link rel="canonical" href="/preferred"><script type="application/ld+json">{"@type":"Organization"}</script></head><body><h1>First</h1><h1>Second</h1><h6>Sixth</h6><a href="/a#top">Internal</a><a href="https://external.example/" rel="nofollow">External</a><img src="/image.png"><p>Useful words</p></body></html>'};
  const d=extract(r,"example.com");assert.equal(d.indexable,false);assert.equal(d.canonical,"https://example.com/preferred");assert.equal(d.headings.h6[0],"Sixth");assert.deepEqual(d.schemaTypes,["Organization"]);assert.equal(d.links[0].internal,true);assert.equal(d.links[1].nofollow,true);assert.equal(d.openGraph["og:title"],"OG title");assert.equal(d.twitter["twitter:card"],"summary");
  const types=pageIssues(d).map(x=>x.type);for(const type of ["noindex","multiple_h1","canonical_mismatch","missing_alt"])assert.ok(types.includes(type),type);
});

import { crawlSettings } from "../src/crawler/settings";
test("free execution enforces small crawl budgets without changing external worker defaults",()=>{
  const free=crawlSettings({CRAWLER_EXECUTION:"embedded",CRAWLER_ENABLED:"true",REDIS_URL:"redis://localhost:6379"});
  assert.equal(free.maxPages,20);assert.equal(free.defaultPages,20);assert.equal(free.concurrency,1);assert.equal(free.renderJs,false);assert.equal(free.maxSitemaps,5);assert.equal(free.maxDurationMs,180000);
  assert.equal(crawlSettings({}).maxPages,500);
  assert.throws(()=>crawlSettings({CRAWLER_EXECUTION:"embedded",CRAWLER_RENDER_JS:"true"}));
  assert.throws(()=>crawlSettings({CRAWLER_ENABLED:"true"}));
  assert.throws(()=>crawlSettings({CRAWLER_EXECUTION:"unknown"}));
});
