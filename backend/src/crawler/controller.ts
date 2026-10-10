import { crawlSettings } from "./settings";
import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, HttpCode } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, VerifiedGuard, access } from "../security";
import { Website, transaction, log } from "../database";
import { fail, parse, recordId, paginate, id as idDto } from "../contracts";
import { CrawlJob, CrawlPage, WebsiteUrl, TechnicalIssue, RobotsRecord, SitemapRecord, CrawlError, terminal } from "./models";
import { normalizeUrl, sameHost } from "./safe-fetch";
const writers = ["Owner","Admin","Marketing Manager","SEO Manager"];
const configDto = z.object({ mode:z.enum(["full","sitemap","single"]).default("full"), maxPages:z.number().int().min(1).max(500).default(100), renderJs:z.boolean().default(false), startUrl:z.string().max(2048).optional(), version:z.number().int().nonnegative() }).strict();
const versionDto = z.object({version:z.number().int().nonnegative()}).strict();
const listDto = z.object({page:z.coerce.number().int().min(1).max(10000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25),search:z.string().max(100).optional(),statusCode:z.coerce.number().int().min(100).max(599).optional(),indexable:z.enum(["true","false"]).optional(),inSitemap:z.enum(["true","false"]).optional(),hasIssue:z.enum(["true","false"]).optional(),redirect:z.enum(["true","false"]).optional(),status:z.enum(["crawled","blocked","error"]).optional(),contentType:z.string().max(100).optional(),sort:z.enum(["url","-url","statusCode","-updatedAt"]).default("-updatedAt")}).strict();
@Controller("organizations/:orgId/websites/:websiteId")
@UseGuards(AuthGuard, VerifiedGuard)
export class CrawlsController {
  private async site(req:any, orgId:string, websiteId:string, write=false, session?:any) {
    await access(req,orgId,write?writers:undefined,session); recordId(websiteId);
    const site=await Website.findOne({_id:websiteId,orgId}).session(session||null).lean();
    if(!site) fail(404,"NOT_FOUND","Website unavailable."); return site;
  }
  @Post("crawls") async start(@Req() req:any,@Param("orgId") orgId:string,@Param("websiteId") websiteId:string,@Body() body:unknown) {
    const settings=crawlSettings();
    const dto=parse(configDto.extend({maxPages:z.number().int().min(1).max(settings.maxPages).default(settings.defaultPages)}),body); await this.site(req,orgId,websiteId,true);
    if(process.env.CRAWLER_ENABLED!=="true" || !process.env.REDIS_URL) fail(503,"CRAWLER_UNAVAILABLE","Crawl worker is not configured yet.");
    if(dto.renderJs && !settings.renderJs) fail(422,"RENDER_UNAVAILABLE","JavaScript rendering is not enabled on this worker.");
    return transaction(async session=>{
      const site=await this.site(req,orgId,websiteId,true,session);
      if(site.status!=="active" || site.verificationStatus!=="verified") fail(409,"WEBSITE_UNVERIFIED","Verify an active website before crawling.");
      if(site.version!==dto.version) fail(409,"VERSION_CONFLICT","Website changed. Reload before crawling.");
      let startUrl:string|undefined;
      if(dto.startUrl) { try{startUrl=normalizeUrl(dto.startUrl);}catch{fail(422,"INVALID_URL","Use a valid HTTP or HTTPS URL.");} if(!sameHost(startUrl!,site.domain)) fail(422,"OUT_OF_SCOPE","Start URL must belong to this website."); }
      if(dto.mode==="single" && !startUrl) fail(422,"INVALID_URL","Enter a URL for a single-page crawl.");
      await Website.updateOne({_id:websiteId,orgId,version:dto.version},{$inc:{crawlRevision:1}},{session});
      const [job]=await CrawlJob.create([{orgId,websiteId,requestedBy:req.user._id,source:"manual",domain:site.domain,websiteVersion:site.version,config:{mode:dto.mode,maxPages:dto.mode==="single"?1:dto.maxPages,renderJs:dto.renderJs,startUrl},status:"queued",active:true}],{session});
      await log(session,req,orgId,"crawl.queued","website",websiteId,null,{jobId:job._id}); return job;
    });
  }
  @Get("crawls") async list(@Req() req:any,@Param("orgId") orgId:string,@Param("websiteId") websiteId:string,@Query() query:any) {await this.site(req,orgId,websiteId);return paginate(CrawlJob,{orgId,websiteId},query,"-executionId");}
  @Get("crawls/:jobId") async detail(@Req() req:any,@Param() p:any) { await this.site(req,p.orgId,p.websiteId);recordId(p.jobId);const job=await CrawlJob.findOne({_id:p.jobId,orgId:p.orgId,websiteId:p.websiteId}).select("-executionId").lean();if(!job)fail(404,"NOT_FOUND","Crawl unavailable.");return job; }
  @Post("crawls/:jobId/cancel") @HttpCode(200) async cancel(@Req() req:any,@Param() p:any,@Body() body:unknown) {
    const {version}=parse(versionDto,body);recordId(p.jobId);
    return transaction(async session=>{await this.site(req,p.orgId,p.websiteId,true,session);const job=await CrawlJob.findOneAndUpdate({_id:p.jobId,orgId:p.orgId,websiteId:p.websiteId,version,active:true},{$set:{status:"cancelled",active:false,completedAt:new Date()},$inc:{version:1}},{new:true,session}).select("-executionId");if(!job)fail(409,"VERSION_CONFLICT","Crawl changed or finished. Refresh its status.");await log(session,req,p.orgId,"crawl.cancelled","website",p.websiteId,null,{jobId:p.jobId});return job;});
  }
  @Post("crawls/:jobId/retry") async retry(@Req() req:any,@Param() p:any,@Body() body:unknown) {return this.repeat(req,p,body,true);}
  @Post("crawls/:jobId/rerun") async rerun(@Req() req:any,@Param() p:any,@Body() body:unknown) {return this.repeat(req,p,body,false);}
  private async repeat(req:any,p:any,body:unknown,retry:boolean) {
    const {version}=parse(versionDto,body);const job:any=await this.detail(req,p);
    if(job.version!==version || !terminal.includes(job.status) || (retry && !["failed","completed_with_errors","cancelled"].includes(job.status)))fail(409,"INVALID_TRANSITION","This crawl cannot be retried in its current state.");
    const site=await this.site(req,p.orgId,p.websiteId,true);return this.start(req,p.orgId,p.websiteId,{...job.config,version:site.version});
  }
  @Get("urls") async urls(@Req() req:any,@Param() p:any,@Query() query:unknown) {
    await this.site(req,p.orgId,p.websiteId);const q=parse(listDto,query), filter:any={orgId:p.orgId,websiteId:p.websiteId};
    if(q.search){const escaped=q.search.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");filter.$or=[{url:{$regex:escaped,$options:"i"}},{"data.title":{$regex:escaped,$options:"i"}}];}
    for(const key of ["indexable"] as const)if(q[key])filter[`data.${key}`]=q[key]==="true";
    if(q.statusCode)filter["data.statusCode"]=q.statusCode;if(q.contentType)filter["data.contentType"]={$regex:q.contentType.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),$options:"i"};
    if(q.inSitemap)filter.inSitemap=q.inSitemap==="true";if(q.status)filter.status=q.status;
    if(q.hasIssue)filter["issues.0"]={$exists:q.hasIssue==="true"};if(q.redirect)filter["data.redirectChain.0"]={$exists:q.redirect==="true"};
    const sort:any=q.sort==="url"?{url:1,_id:1}:q.sort==="-url"?{url:-1,_id:-1}:q.sort==="statusCode"?{"data.statusCode":1,_id:1}:{updatedAt:-1,_id:-1};
    const [items,total]=await Promise.all([WebsiteUrl.find(filter).select("-data.links -data.images -data.headings -data.headers -data.openGraph -data.twitter").sort(sort).skip((q.page-1)*q.limit).limit(q.limit).lean(),WebsiteUrl.countDocuments(filter)]);return{items,total,page:q.page,limit:q.limit};
  }
  @Get("urls/:urlId") async urlDetail(@Req() req:any,@Param() p:any) {await this.site(req,p.orgId,p.websiteId);recordId(p.urlId);const item:any=await WebsiteUrl.findOne({_id:p.urlId,orgId:p.orgId,websiteId:p.websiteId}).lean();if(!item)fail(404,"NOT_FOUND","URL unavailable.");const history=await CrawlPage.find({orgId:p.orgId,websiteId:p.websiteId,urlHash:item.urlHash}).select("jobId status data.statusCode data.crawledAt").sort({_id:-1}).limit(25).lean();return{...item,history};}
  @Get("crawl-summary") async summary(@Req() req:any,@Param() p:any) {await this.site(req,p.orgId,p.websiteId);const scope={orgId:p.orgId,websiteId:p.websiteId};const [last,total,indexable]=await Promise.all([CrawlJob.findOne(scope).select("-executionId").sort({_id:-1}).lean(),WebsiteUrl.countDocuments(scope),WebsiteUrl.countDocuments({...scope,"data.indexable":true})]);return{last,total,indexable,notIndexable:total-indexable,limits:crawlSettings()};}
  @Get("crawls/:jobId/issues") async issues(@Req() req:any,@Param() p:any,@Query() query:any) {await this.detail(req,p);const {severity,type,...page}=parse(z.object({severity:z.enum(["Critical","High","Medium","Low","Opportunity"]).optional(),type:z.string().regex(/^[a-z_]+$/).max(100).optional(),cursor:idDto.optional(),limit:z.coerce.number().int().min(1).max(100).default(25)}).strict(),query);return paginate(TechnicalIssue,{orgId:p.orgId,websiteId:p.websiteId,jobId:p.jobId,...(severity?{severity}:{}),...(type?{type}:{})},page);}
  @Get("crawls/:jobId/robots") async robots(@Req() req:any,@Param() p:any) {await this.detail(req,p);return{items:await RobotsRecord.find({orgId:p.orgId,websiteId:p.websiteId,jobId:p.jobId}).lean()};}
  @Get("crawls/:jobId/sitemaps") async sitemaps(@Req() req:any,@Param() p:any) {await this.detail(req,p);return{items:await SitemapRecord.find({orgId:p.orgId,websiteId:p.websiteId,jobId:p.jobId}).lean()};}
  @Get("crawls/:jobId/errors") async errors(@Req() req:any,@Param() p:any,@Query() q:any) {await this.detail(req,p);return paginate(CrawlError,{orgId:p.orgId,websiteId:p.websiteId,jobId:p.jobId},q);}
}
