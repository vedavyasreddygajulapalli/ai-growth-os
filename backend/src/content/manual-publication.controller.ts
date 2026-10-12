import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AuthGuard, VerifiedGuard } from '../security';
import { fail, parse, recordId } from '../contracts';
import { log, transaction } from '../database';
import { Fetcher, normalizeUrl, safeFetch } from '../crawler/safe-fetch';
import { ContentItem, ManualPublication } from './models';
import { publishers, scope } from './scope';
import { renderBlocks } from './contracts';

const versionDto = z.object({ version: z.number().int().nonnegative() }).strict();
const confirmDto = versionDto.extend({ liveUrl: z.string().trim().url().max(2048) }).strict();
const plain = (value: string) => value.replace(/\s+/g, ' ').trim();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return entities[character];
});
const markdown = (blocks: any[]) => blocks.map(block => {
  const text = block.text.replace(/\r?\n/g, '\n');
  if (block.type === 'heading') return `${'#'.repeat(block.level || 2)} ${text}`;
  if (block.type === 'quote') return text.split('\n').map((line: string) => `> ${line}`).join('\n');
  if (block.type === 'list') return text.split('\n').filter(Boolean).map((line: string) => `- ${line}`).join('\n');
  return text;
}).join('\n\n');

export function manualBundle(item: any, domain: string) {
  const title = plain(item.title);
  const description = plain(item.description || '').slice(0, 500);
  const seoTitle = plain(item.seoTitle || title).slice(0, 200);
  const canonical = `https://${domain}/${item.slug}`;
  const body = renderBlocks(item.blocks || []);
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(seoTitle)}</title>\n${description ? `<meta name="description" content="${escapeHtml(description)}">\n` : ''}<link rel="canonical" href="${canonical}">\n</head>\n<body>\n<main>\n<h1>${escapeHtml(title)}</h1>\n${body}\n</main>\n</body>\n</html>`;
  const md = `# ${title}\n\n${description ? `${description}\n\n` : ''}${markdown(item.blocks || [])}\n`;
  const bundle = { title, slug: item.slug, type: item.type, seoTitle, description, keywords: item.keywords || [], canonical, html, markdown: md, sourceRevision: item.revision };
  const checksum = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  return { bundle, checksum };
}

let verifyFetch: Fetcher = safeFetch;
export function setManualPublishFetcherForTests(fetcher?: Fetcher) {
  if (process.env.NODE_ENV !== 'test') throw Error('TEST_ONLY');
  verifyFetch = fetcher || safeFetch;
}

@Controller('organizations/:orgId/websites/:websiteId/content/:contentId/manual-publication')
@UseGuards(AuthGuard, VerifiedGuard)
export class ManualPublicationController {
  @Get()
  async get(@Req() req: any, @Param('orgId') org: string, @Param('websiteId') site: string, @Param('contentId') contentId: string) {
    recordId(contentId);
    await scope(req, org, site, publishers);
    const records = await ManualPublication.find({ orgId: org, websiteId: site, contentId }).sort({ sourceRevision: -1 }).limit(20).lean();
    return { items: records };
  }

  @Post()
  async create(@Req() req: any, @Param('orgId') org: string, @Param('websiteId') site: string, @Param('contentId') contentId: string, @Body() body: any) {
    recordId(contentId);
    const d = parse(versionDto, body);
    const website = await scope(req, org, site, publishers);
    const item: any = await ContentItem.findOne({ _id: contentId, orgId: org, websiteId: site });
    if (!item) fail(404, 'NOT_FOUND', 'Content unavailable.');
    if (item.version !== d.version || item.approvedRevision !== item.revision || !['approved', 'published'].includes(item.status)) fail(409, 'APPROVAL_REQUIRED', 'Approve the current content revision before preparing an external publishing kit.');
    const existing: any = await ManualPublication.findOne({ orgId: org, websiteId: site, contentId, sourceRevision: item.revision });
    if (existing) return { publication: existing, bundle: existing.bundle };
    const { bundle, checksum } = manualBundle(item, website.domain);
    return transaction(async session => {
      await scope(req, org, site, publishers, session);
      const current: any = await ContentItem.findOne({ _id: contentId, orgId: org, websiteId: site, version: d.version, revision: item.revision, approvedRevision: item.revision, status: { $in: ['approved', 'published'] } }).session(session);
      if (!current) fail(409, 'VERSION_CONFLICT', 'Content changed while preparing the publishing kit. Reload and try again.');
      let publication: any = await ManualPublication.findOne({ orgId: org, websiteId: site, contentId, sourceRevision: current.revision }).session(session);
      if (!publication) {
        [publication] = await ManualPublication.create([{ orgId: org, websiteId: site, contentId, sourceVersion: current.version, sourceRevision: current.revision, state: 'ready', bundle, checksum }], { session });
        await log(session, req, org, 'content.manual_kit_created', 'manual_publication', publication._id, null, { contentId, sourceRevision: current.revision, checksum });
      }
      return { publication, bundle: publication.bundle };
    });
  }

  @Post(':publicationId/confirm')
  async confirm(@Req() req: any, @Param('orgId') org: string, @Param('websiteId') site: string, @Param('contentId') contentId: string, @Param('publicationId') publicationId: string, @Body() body: any) {
    recordId(contentId); recordId(publicationId);
    const d = parse(confirmDto, body);
    const website = await scope(req, org, site, publishers);
    const url = normalizeUrl(d.liveUrl);
    const host = new URL(url).hostname.toLowerCase();
    if (!['https:', 'http:'].includes(new URL(url).protocol) || ![website.domain, `www.${website.domain}`].includes(host) || new URL(url).username || new URL(url).password) fail(422, 'PUBLISH_URL_DOMAIN_MISMATCH', 'The published URL must use this website’s verified domain.');
    return transaction(async session => {
      await scope(req, org, site, publishers, session);
      const publication: any = await ManualPublication.findOne({ _id: publicationId, orgId: org, websiteId: site, contentId, version: d.version, state: 'ready' }).session(session);
      if (!publication) fail(409, 'VERSION_CONFLICT', 'Publishing kit changed or was already reported. Reload the record.');
      const before = { state: publication.state, liveUrl: publication.liveUrl };
      publication.liveUrl = url; publication.state = 'reported'; publication.verification = undefined; publication.version++;
      await publication.save({ session });
      await log(session, req, org, 'content.manual_publication_reported', 'manual_publication', publication._id, before, { state: publication.state, liveUrl: url, sourceRevision: publication.sourceRevision });
      return publication;
    });
  }

  @Post(':publicationId/verify')
  async verify(@Req() req: any, @Param('orgId') org: string, @Param('websiteId') site: string, @Param('contentId') contentId: string, @Param('publicationId') publicationId: string, @Body() body: any) {
    recordId(contentId); recordId(publicationId);
    const d = parse(versionDto, body);
    const website = await scope(req, org, site, publishers);
    const publication: any = await ManualPublication.findOne({ _id: publicationId, orgId: org, websiteId: site, contentId, version: d.version, state: 'reported' });
    if (!publication?.liveUrl) fail(409, 'PUBLICATION_NOT_REPORTED', 'Report the live URL before verifying it.');
    const host = new URL(publication.liveUrl).hostname;
    if (![website.domain, `www.${website.domain}`].includes(host)) fail(409, 'PUBLISH_URL_DOMAIN_MISMATCH', 'The reported URL no longer matches the verified website.');
    let result: any;
    try { result = await verifyFetch(publication.liveUrl, host); }
    catch (error: any) { fail(502, 'PUBLICATION_CHECK_FAILED', 'The public page could not be checked safely. Confirm the URL is reachable and try again.'); }
    const contentType = result.headers?.['content-type'] || '';
    if (!contentType.toLowerCase().includes('text/html')) fail(422, 'PUBLICATION_NOT_HTML', 'The URL is reachable but did not return an HTML page.');
    const $ = load(result.body);
    const pageTitle = plain($('title').first().text() || $('h1').first().text());
    const canonical = $('link[rel="canonical"]').attr('href') || '';
    const titleMatched = pageTitle.toLowerCase() === String(publication.bundle.title).toLowerCase();
    const canonicalMatched = canonical ? normalizeUrl(canonical, publication.liveUrl) === publication.liveUrl : false;
    const verified = result.statusCode >= 200 && result.statusCode < 300 && (titleMatched || canonicalMatched);
    return transaction(async session => {
      await scope(req, org, site, publishers, session);
      const current: any = await ManualPublication.findOne({ _id: publicationId, orgId: org, websiteId: site, contentId, version: d.version, state: 'reported' }).session(session);
      if (!current) fail(409, 'VERSION_CONFLICT', 'Publication changed while checking the page. Reload and try again.');
      const before = { state: current.state, verification: current.verification };
      current.verification = { statusCode: result.statusCode, pageTitle: pageTitle.slice(0, 200), titleMatched, canonicalMatched, checkedAt: new Date() };
      if (verified) { current.state = 'verified'; current.verifiedAt = new Date(); }
      current.version++;
      await current.save({ session });
      await log(session, req, org, verified ? 'content.manual_publication_verified' : 'content.manual_publication_check_failed', 'manual_publication', current._id, before, { state: current.state, verification: current.verification });
      return { publication: current, verified, message: verified ? 'The live page returned successfully and its title or canonical matches this approved content.' : 'The page is reachable, but its title or canonical could not be matched. The publication remains reported, not verified.' };
    });
  }
}
