import { randomUUID } from "node:crypto";
import { Website, transaction } from "../database";
import { CrawlJob, CrawlPage, WebsiteUrl, CrawlError, RobotsRecord, SitemapRecord, DiscoveredLink, TechnicalIssue } from "./models";
import { Fetcher, safeFetch, normalizeUrl, sameHost, USER_AGENT } from "./safe-fetch";
import { hash, robots, sitemap, extract, pageIssues, issue } from "./extract";
import { renderPage } from "./render";

export async function runCrawl(id: string, fetcher: Fetcher = safeFetch) {
  const executionId = randomUUID();
  const job: any = await CrawlJob.findOneAndUpdate({ _id: id, status: { $in: ["queued", "running"] }, active: true }, { $set: { status: "running", executionId, startedAt: new Date(), heartbeatAt: new Date(), error: null }, $inc: { version: 1 } }, { new: true }).lean();
  if (!job) return;
  const scope = { orgId: job.orgId, websiteId: job.websiteId }, evidence = { ...scope, jobId: job._id, source: job.source, status: "stored" };
  const active = async () => {
    const [current, site]: any[] = await Promise.all([CrawlJob.exists({ _id: id, executionId, status: "running" }), Website.findOne({ _id: job.websiteId, orgId: job.orgId, status: "active", verificationStatus: "verified", domain: job.domain })]);
    if (!current) throw Error("CANCELLED"); if (!site) throw Error("WEBSITE_CHANGED");
  };
  const persist = async (fn: (session: any) => Promise<void>) => transaction(async session => {
    const locked = await CrawlJob.updateOne({ _id: id, executionId, status: "running" }, { $set: { heartbeatAt: new Date() } }, { session });
    if (!locked.matchedCount) throw Error("CANCELLED");
    const site = await Website.updateOne({ _id:job.websiteId, orgId:job.orgId, status:"active", verificationStatus:"verified", domain:job.domain }, { $inc:{crawlRevision:1} }, { session });
    if (!site.matchedCount) throw Error("WEBSITE_CHANGED");
    await fn(session);
  });
  try {
    await active();
    if (job.config.renderJs && process.env.CRAWLER_RENDER_JS !== "true") throw Error("RENDER_UNAVAILABLE");
    // A BullMQ retry rebuilds this run's evidence deterministically. Prior runs remain intact.
    await persist(async session => { for (const model of [CrawlPage,CrawlError,RobotsRecord,SitemapRecord,DiscoveredLink,TechnicalIssue]) await model.deleteMany({ ...scope, jobId: id }, { session }); });
    const root = `https://${job.domain}/`, robotsUrl = root + "robots.txt";
    let robotsBody = "", robotsStatus = 0;
    try { const r = await fetcher(robotsUrl, job.domain); robotsStatus = r.statusCode; if (r.statusCode >= 200 && r.statusCode < 300) robotsBody = r.body; else if (![404,410].includes(r.statusCode)) throw Error("ROBOTS_UNAVAILABLE"); }
    catch { await persist(async session => { await RobotsRecord.create([{ ...evidence, url: robotsUrl, status: "error", error: "ROBOTS_UNAVAILABLE" }], { session }); }); throw Error("ROBOTS_UNAVAILABLE"); }
    const rules = robots(robotsUrl, robotsBody), allowed = (url: string) => rules.isAllowed(url, USER_AGENT) !== false;
    const crawlDelay = Number(rules.getCrawlDelay(USER_AGENT) || 0);
    if (!Number.isFinite(crawlDelay) || crawlDelay > 60) throw Error("ROBOTS_DELAY_EXCEEDS_BUDGET");
    const transport = fetcher;
    fetcher = (url, domain, allowed) => transport(url, domain, allowed, undefined, Math.max(1000, crawlDelay * 1000));
    await persist(async session => { await RobotsRecord.create([{ ...evidence, url: robotsUrl, httpStatus: robotsStatus, body: robotsBody, sitemaps: rules.getSitemaps(), status: robotsStatus === 404 || robotsStatus === 410 ? "missing" : "found" }], { session }); });
    const frontier = new Map<string, string>(), sitemapUrls = new Set<string>(), visitedMaps = new Set<string>();
    let truncated = false, sitemapErrors = 0;
    const add = (raw: string, source: string) => {
      try { const url = normalizeUrl(raw, root); if (!sameHost(url, job.domain)) return; if (!frontier.has(url)) { if (frontier.size >= job.config.maxPages) { truncated = true; return; } frontier.set(url, source); } } catch {}
    };
    if (job.config.mode !== "sitemap") add(job.config.startUrl || root, "seed");
    const maps = [...rules.getSitemaps(), root + "sitemap.xml"];
    if (job.config.mode !== "single") while (maps.length && visitedMaps.size < 20) {
      await active();
      const raw = maps.shift()!; let url: string;
      try { url = normalizeUrl(raw, root); if (!sameHost(url, job.domain) || visitedMaps.has(url)) continue; visitedMaps.add(url);
        const response = await fetcher(url, job.domain, allowed);
        if (response.statusCode !== 200) throw Error("SITEMAP_HTTP_ERROR");
        const parsed = sitemap(response.body);
        const urls = parsed.urls.slice(0, 5000); if (parsed.urls.length > 5000) truncated = true;
        for (const x of urls) { try { const u = normalizeUrl(x.url); if (sameHost(u, job.domain)) { sitemapUrls.add(u); add(u, "sitemap"); } } catch {} }
        maps.push(...parsed.nested.slice(0,20));
        await persist(async session => { await SitemapRecord.create([{ ...evidence, url, httpStatus: response.statusCode, urls, status: "parsed" }], { session }); });
      } catch {
        sitemapErrors++;
        await persist(async session => { await SitemapRecord.create([{ ...evidence, url: raw, status: "error", error: "SITEMAP_UNAVAILABLE_OR_INVALID" }], { session }); });
      }
    }
    if (!frontier.size) throw Error("NO_URLS_DISCOVERED");
    const pages: any[] = []; let successCount = 0, redirectCount = 0, errorCount = sitemapErrors;
    for (const [url, source] of frontier) {
      await active();
      let data: any, issues: any[] = [], status = "crawled";
      try {
        if (!allowed(url)) { status = "blocked"; issues = [issue("blocked_robots")]; data = { requestedUrl: url, finalUrl: url, indexable: false, crawledAt: new Date().toISOString(), links: [], images: [] }; }
        else {
          let response = await fetcher(url, job.domain, allowed);
          if (/html/i.test(response.headers["content-type"] || "")) {
            if (job.config.renderJs) response = await renderPage(response, job.domain, fetcher, allowed);
            data = extract(response, job.domain);
          } else data = { requestedUrl: url, finalUrl: response.finalUrl, statusCode: response.statusCode, headers: response.headers, contentType: response.headers["content-type"], pageSize: response.bytes, responseMs: response.responseMs, redirectChain: response.redirects, indexable: false, crawledAt: new Date().toISOString(), links: [], images: [] };
          issues = pageIssues(data);
          if (response.statusCode >= 400) {
            errorCount++;
            await persist(async session => { await CrawlError.create([{ ...evidence, url, status:"error", code:`HTTP_${response.statusCode}`, message:"Page returned an HTTP error." }], { session }); });
          } else successCount++;
          if (response.redirects.length) redirectCount++;
          if (job.config.mode === "full") for (const link of data.links) if (link.internal && !link.nofollow) add(link.url, "internal_link");
        }
      } catch (err) {
        const code = err instanceof Error && /^[A-Z_]+$/.test(err.message) ? err.message : "FETCH_FAILED";
        status = "error"; errorCount++; issues = [issue(code === "REDIRECT_LOOP" ? "redirect_loop" : "fetch_error")];
        data = { requestedUrl: url, finalUrl: url, error: code, indexable: false, crawledAt: new Date().toISOString(), links: [], images: [] };
        await persist(async session => { await CrawlError.create([{ ...evidence, url, status: "error", code, message: "Page fetch did not complete." }], { session }); });
      }
      const page = { ...evidence, url, urlHash: hash(url), source, status, data, issues, inSitemap: sitemapUrls.has(url), incomingLinks: 0 }; pages.push(page);
      await persist(async session => {
        await CrawlPage.create([page], { session });
        for (const link of data.links) await DiscoveredLink.updateOne({ ...scope, jobId: id, from: url, to: link.url }, { $setOnInsert: { ...evidence, from: url, to: link.url, anchor: link.anchor, internal: link.internal, nofollow: link.nofollow } }, { upsert: true, session });
        await CrawlJob.updateOne({ _id: id, executionId }, { $set: { discovered: frontier.size, crawled: pages.length, successCount, redirectCount, errorCount, progress: Math.min(99, Math.round(pages.length / Math.max(frontier.size,1) * 100)), lastUrl: url, truncated }, $inc: { version: 1 } }, { session });
      });
    }
    const byUrl = new Map(pages.map(p => [p.url,p]));
    for (const page of pages) {
      await active();
      const extra = new Set<string>();
      page.incomingLinks = pages.filter(p => p.url !== page.url && p.data.links.some((l: any) => l.url === page.url && l.internal)).length;
      if (page.inSitemap && page.url !== root && !page.incomingLinks) extra.add("orphan_candidate");
      else if (page.incomingLinks === 1) extra.add("few_internal_links");
      if (!page.inSitemap && page.source === "internal_link" && sitemapUrls.size) extra.add("missing_from_sitemap");
      for (const p of pages) if (p.url !== page.url) {
        if (page.data.title && p.data.title === page.data.title) extra.add("duplicate_title");
        if (page.data.description && p.data.description === page.data.description) extra.add("duplicate_description");
        if (page.data.contentSize > 0 && p.data.contentHash === page.data.contentHash) extra.add("duplicate_content");
        if (p.data.finalUrl === page.data.finalUrl) extra.add("duplicate_url");
      }
      for (const link of page.data.links) { const target = byUrl.get(link.url); if (link.internal && target) { if (target.data.statusCode >= 400) extra.add("broken_internal_link"); if (target.data.redirectChain?.length) extra.add("redirected_internal_link"); } }
      page.issues.push(...[...extra].map(issue));
      await persist(async session => {
        await CrawlPage.updateOne({ jobId:id, urlHash:page.urlHash, ...scope }, { $set:{ issues:page.issues, incomingLinks:page.incomingLinks } }, { session });
        for (const entry of page.issues) await TechnicalIssue.create([{ ...evidence, url:page.url, ...entry, status:"open" }], { session });
        for (const link of page.data.links) { const target = byUrl.get(link.url); if (target?.data.statusCode) await DiscoveredLink.updateOne({ ...scope, jobId:id, from:page.url, to:link.url }, { $set:{ httpStatus:target.data.statusCode } }, { session }); }
      });
    }
    // Publish inventory only for a completed run; cancelled/failed attempts never replace it.
    await persist(async session => {
      for (const page of pages) await WebsiteUrl.updateOne({ ...scope, urlHash:page.urlHash }, { $set:page, $inc:{ version:1 } }, { upsert:true, session });
      await CrawlJob.updateOne({ _id:id, executionId }, { $set:{ status:errorCount ? "completed_with_errors" : "completed", active:false, completedAt:new Date(), durationMs:Date.now()-new Date(job.startedAt).getTime(), progress:100, discovered:frontier.size, truncated }, $inc:{version:1} }, {session});
    });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "CRAWL_FAILED";
    await CrawlJob.updateOne({ _id:id, executionId, status:"running" }, { $set:{status:"failed",active:false,error:code,completedAt:new Date(),durationMs:Date.now()-new Date(job.startedAt).getTime()},$inc:{version:1} });
    if (code !== "CANCELLED") console.error(JSON.stringify({event:"crawl.failed",jobId:id,code}));
  }
}
