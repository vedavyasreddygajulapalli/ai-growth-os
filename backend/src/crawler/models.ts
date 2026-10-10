import mongoose, { Schema } from "mongoose";
const oid = Schema.Types.ObjectId;
const scope = { orgId: { type: oid, required: true }, websiteId: { type: oid, required: true } };
const scoped = (name: string, collection: string, fields: any, indexes: any[] = []) => {
  const schema = new Schema({ ...scope, ...fields }, { timestamps: true, strict: true });
  schema.index({ orgId: 1, websiteId: 1, _id: -1 });
  for (const [keys, options] of indexes) schema.index(keys, options || {});
  return mongoose.model(name, schema, collection);
};
export const CrawlJob = scoped("CrawlJob", "crawl_jobs", {
  requestedBy: oid, source: String, domain: String, websiteVersion: Number,
  config: Schema.Types.Mixed, status: { type: String, enum: ["queued","running","completed","completed_with_errors","failed","cancelled"], default: "queued" }, active: { type: Boolean, default: true },
  version: { type: Number, default: 0 }, discovered: { type: Number, default: 0 }, crawled: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 }, redirectCount: { type: Number, default: 0 }, errorCount: { type: Number, default: 0 },
  progress: { type: Number, default: 0 }, startedAt: Date, completedAt: Date, durationMs: Number,
  lastUrl: String, error: String, executionId: String, heartbeatAt: Date, truncated: Boolean,
}, [[{ orgId: 1, websiteId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } }]]);
const evidence = { jobId: { type: oid, required: true }, source: String, version: { type: Number, default: 0 }, status: String };
export const CrawlPage = scoped("CrawlPage", "crawl_pages", { ...evidence, url: String, urlHash: String, data: Schema.Types.Mixed, issues: [Schema.Types.Mixed], inSitemap: Boolean, incomingLinks: Number }, [[{ jobId: 1, urlHash: 1 }, { unique: true }]]);
// Immutable per-crawl snapshots are crawl_pages; current inventory points to its latest successful write.
export const WebsiteUrl = scoped("WebsiteUrl", "website_urls", { ...evidence, url: String, urlHash: String, data: Schema.Types.Mixed, issues: [Schema.Types.Mixed], inSitemap: Boolean, incomingLinks: Number }, [[{ orgId: 1, websiteId: 1, urlHash: 1 }, { unique: true }]]);
export const CrawlError = scoped("CrawlError", "crawl_errors", { ...evidence, url: String, code: String, message: String });
export const DiscoveredLink = scoped("DiscoveredLink", "discovered_links", { ...evidence, from: String, to: String, anchor: String, internal: Boolean, nofollow: Boolean, httpStatus: Number }, [[{ jobId: 1, from: 1, to: 1 }, { unique: true }]]);
export const RobotsRecord = scoped("RobotsRecord", "robots_records", { ...evidence, url: String, httpStatus: Number, body: String, sitemaps: [String], error: String }, [[{ jobId: 1 }, { unique: true }]]);
export const SitemapRecord = scoped("SitemapRecord", "sitemap_records", { ...evidence, url: String, httpStatus: Number, urls: [Schema.Types.Mixed], error: String }, [[{ jobId: 1, url: 1 }, { unique: true }]]);
export const TechnicalIssue = scoped("TechnicalIssue", "technical_issues", { ...evidence, url: String, type: String, severity: String, why: String, recommendation: String }, [[{ jobId: 1, url: 1, type: 1 }, { unique: true }]]);
export const crawlerModels = [CrawlJob, CrawlPage, WebsiteUrl, CrawlError, DiscoveredLink, RobotsRecord, SitemapRecord, TechnicalIssue];
export const terminal = ["completed", "completed_with_errors", "failed", "cancelled"];
