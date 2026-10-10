import * as cheerio from "cheerio";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import robotsParser from "robots-parser";
import { createHash } from "node:crypto";
import { normalizeUrl, sameHost, USER_AGENT, FetchResult } from "./safe-fetch";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function robots(url: string, body: string) { return robotsParser(url, body); }
export function sitemap(body: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) throw Error("INVALID_SITEMAP");
  const doc = new XMLParser({ ignoreAttributes: true, processEntities: false, isArray: name => ["url", "sitemap"].includes(name) }).parse(body);
  if (!doc.urlset && !doc.sitemapindex) throw Error("INVALID_SITEMAP");
  return { nested: (doc.sitemapindex?.sitemap || []).map((x: any) => String(x.loc || "")), urls: (doc.urlset?.url || []).map((x: any) => ({ url: String(x.loc || ""), lastmod: x.lastmod ? String(x.lastmod) : null })) };
}
export function extract(result: FetchResult, domain: string) {
  const $ = cheerio.load(result.body);
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const resolve = (raw: string) => { try { return normalizeUrl(raw, result.finalUrl); } catch { return null; } };
  const title = clean($("title").first().text()).slice(0, 2000), description = $("meta[name='description']").attr("content")?.slice(0, 4000) || "";
  const headings = Object.fromEntries([1,2,3,4,5,6].map(n => [`h${n}`, $(`h${n}`).slice(0,100).map((_, el) => clean($(el).text()).slice(0,1000)).get()]));
  const metaRobots = ($("meta[name='robots']").attr("content") || "") + "," + (result.headers["x-robots-tag"] || "");
  const links = $("a[href]").slice(0,2000).map((_, el) => ({ url: resolve($(el).attr("href") || ""), anchor: clean($(el).text()).slice(0,500), nofollow: /nofollow/i.test($(el).attr("rel") || "") })).get().filter(x => x.url).map(x => ({ ...x, internal: sameHost(x.url!, domain) }));
  const images = $("img").slice(0,500).map((_, el) => ({ url: resolve($(el).attr("src") || ""), alt: $(el).attr("alt")?.slice(0,1000) || "" })).get();
  const schemaTypes = new Set<string>(); let structuredData = false;
  const visit = (v: any, depth = 0) => { if (!v || typeof v !== "object" || depth > 20) return; if (v["@type"]) for (const t of [v["@type"]].flat()) if (typeof t === "string") schemaTypes.add(t.slice(0,100)); for (const child of Object.values(v)) if (typeof child === "object") visit(child, depth + 1); };
  $("script[type='application/ld+json']").each((_, el) => { try { visit(JSON.parse($(el).text())); structuredData = true; } catch {} });
  $("[itemtype]").each((_, el) => { schemaTypes.add(($(el).attr("itemtype") || "").slice(0,200)); structuredData = true; });
  const metadata = (prefix: string) => Object.fromEntries($("meta").map((_, el) => { const k = $(el).attr("property") || $(el).attr("name") || ""; return k.startsWith(prefix) ? [[k, ($(el).attr("content") || "").slice(0,2000)]] : []; }).get());
  $("script,style,noscript,svg").remove(); const text = clean($("body").text());
  const canonicalRaw = $("link[rel='canonical']").first().attr("href") || "";
  return { requestedUrl: result.url, finalUrl: result.finalUrl, statusCode: result.statusCode, redirectChain: result.redirects, headers: result.headers, contentType: result.headers["content-type"] || "", responseMs: result.responseMs, pageSize: result.bytes, crawledAt: new Date().toISOString(), title, titleLength: title.length, description, descriptionLength: description.length, headings, canonical: canonicalRaw ? resolve(canonicalRaw) : null, metaRobots, indexable: result.statusCode >= 200 && result.statusCode < 300 && !/\b(noindex|none)\b/i.test(metaRobots), follow: !/\b(nofollow|none)\b/i.test(metaRobots), lang: $("html").attr("lang") || "", schemaTypes: [...schemaTypes], structuredData, openGraph: metadata("og:"), twitter: metadata("twitter:"), wordCount: text ? text.split(/\s+/).length : 0, contentSize: text.length, contentHash: hash(text), links, images };
}
export const issueDefinitions: Record<string, [string,string,string]> = {
  http_4xx:["High","Page is unavailable.","Fix the URL or restore the page."], http_5xx:["Critical","Server failed to serve the page.","Investigate application/server errors."],
  redirect_chain:["Medium","Extra redirects delay access.","Link directly to the final URL."], redirect_loop:["Critical","The redirect never reaches content.","Remove cyclic redirects."],
  missing_title:["High","Search results lack a useful page title.","Write a unique descriptive title."], duplicate_title:["Medium","Multiple pages share a title.","Differentiate titles by page intent."], title_length:["Low","Title may be too short or truncated.","Review title length and clarity."],
  missing_description:["Medium","Description metadata is absent.","Write a relevant description."], duplicate_description:["Low","Descriptions repeat across pages.","Write distinct descriptions."],
  missing_h1:["Medium","Main heading is absent.","Add a clear main heading."], multiple_h1:["Low","Multiple main headings require review.","Review heading hierarchy."],
  missing_canonical:["Low","Preferred URL is not declared.","Set a valid canonical URL."], canonical_mismatch:["Medium","Canonical points elsewhere.","Confirm intended canonical target."],
  noindex:["Opportunity","Page requests exclusion from indexing.","Confirm noindex is intentional."], blocked_robots:["Opportunity","robots.txt restricts crawling.","Review robots rules if crawling is intended."],
  duplicate_url:["Low","Multiple URL forms reach one page.","Use consistent internal URLs."], duplicate_content:["Medium","Text matches another crawled page.","Review consolidation or canonicalization."],
  broken_internal_link:["High","An internal link points to an unavailable URL.","Update or remove the link."], redirected_internal_link:["Low","An internal link redirects.","Link to the final URL."],
  orphan_candidate:["Medium","Sitemap URL has no incoming links within this crawl.","Check navigation; limited crawls cannot prove orphan status."], few_internal_links:["Opportunity","Few crawled pages link here.","Review internal linking opportunities."],
  missing_alt:["Low","An image has empty or absent alt text.","Review meaningful alt text; decorative images may be intentionally empty."], missing_schema:["Opportunity","No structured data was detected.","Consider relevant structured data."],
  insecure_http:["High","A page is served over HTTP.","Serve and link to HTTPS."], missing_from_sitemap:["Low","Linked URL is absent from discovered sitemaps.","Review sitemap inclusion."], fetch_error:["High","Page could not be fetched.","Inspect timeout, network or safety errors."],
};
export function issue(type: string) { const [severity, why, recommendation] = issueDefinitions[type]; return { type, severity, why, recommendation, ruleVersion: 1 }; }
export function pageIssues(d: any) {
  const types: string[] = [];
  if (d.statusCode >= 500) types.push("http_5xx"); else if (d.statusCode >= 400) types.push("http_4xx");
  if (d.redirectChain?.length > 1) types.push("redirect_chain");
  if (d.finalUrl?.startsWith("http:")) types.push("insecure_http");
  if (!/html/i.test(d.contentType)) return types.map(issue);
  if (!d.title) types.push("missing_title"); else if (d.title.length < 15 || d.title.length > 60) types.push("title_length");
  if (!d.description) types.push("missing_description");
  if (!d.headings.h1.length) types.push("missing_h1"); else if (d.headings.h1.length > 1) types.push("multiple_h1");
  if (!d.canonical) types.push("missing_canonical"); else if (d.canonical !== d.finalUrl) types.push("canonical_mismatch");
  if (/\b(noindex|none)\b/i.test(d.metaRobots || "")) types.push("noindex");
  if (d.images.some((x: any) => !x.alt)) types.push("missing_alt");
  if (!d.structuredData) types.push("missing_schema");
  return types.map(issue);
}
