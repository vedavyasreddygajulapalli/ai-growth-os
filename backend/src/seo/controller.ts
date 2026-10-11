import {issueQuery,schemaDto} from './contracts';
import {sameHost} from '../crawler/safe-fetch';
import {z} from 'zod';
import {parse,recordId,fail,id} from '../contracts';
import {transaction,log,Membership,User} from '../database';
import {SeoIssueWorkflow,SeoSchemaDraft,SeoProviderConnection} from './models';
import {seoProviderCatalog} from './providers';
import {canResolve} from './recheck';
import {randomUUID} from 'node:crypto';
import {ContentItem,CmsConnection,PublishJob} from '../content/models';
const writers=['Owner','Admin','Marketing Manager','SEO Manager'];
const transition=z.object({version:z.number().int().nonnegative(),action:z.enum(['open','in_progress','ignored','recheck']),assigneeId:id.nullable(),reason:z.string().trim().min(3).max(1000)}).strict();
import {Controller,Get,Post,Body,Query,Param,Req,UseGuards} from '@nestjs/common';
import {AuthGuard,VerifiedGuard} from '../security';
import {scope} from '../content/scope';
import {CrawlJob,CrawlPage,TechnicalIssue} from '../crawler/models';

@Controller('organizations/:orgId/websites/:websiteId/seo')
@UseGuards(AuthGuard,VerifiedGuard)
export class SeoController {
  @Get('publish-targets') async schemaPublishTargets(@Req() req:any,@Param() p:any){
    const site=await scope(req,p.orgId,p.websiteId);
    const cms=await CmsConnection.findOne({orgId:site.orgId,websiteId:site._id,status:'connected'});
    if(!cms||cms.origin!=='https://'+site.domain||site.verificationStatus!=='verified')return {items:[],available:false,reason:'Connect the verified WordPress website first.'};
    const items=await ContentItem.find({orgId:site.orgId,websiteId:site._id,status:'published',remoteOrigin:cms.origin,remoteId:{$type:'number'}}).select('title liveUrl remoteId remoteModified version type').sort({_id:-1}).limit(100).lean();
    return {items,available:!!process.env.CMS_SCHEMA_META_KEY,reason:process.env.CMS_SCHEMA_META_KEY?null:'Configure the registered WordPress REST meta key before publishing schema.'};
  }
  @Post('schema/:schemaId/publish') async publishSchema(@Req() req:any,@Param() p:any,@Body() body:unknown){
    recordId(p.schemaId);
    const d=parse(z.object({version:z.number().int().nonnegative(),contentId:id,contentVersion:z.number().int().nonnegative(),reason:z.string().trim().min(3).max(1000)}).strict(),body);
    if(process.env.CRAWLER_ENABLED!=='true'||!process.env.REDIS_URL)fail(503,'WORKER_UNAVAILABLE','The WordPress publishing worker is not enabled.');
    const metaKey=process.env.CMS_SCHEMA_META_KEY||'';
    if(!/^[a-z][a-z0-9_]{2,63}$/.test(metaKey))fail(503,'CMS_SCHEMA_META_UNSUPPORTED','Configure a registered WordPress REST meta key before publishing structured data.');
    return transaction(async session=>{
      const site=await scope(req,p.orgId,p.websiteId,['Owner','Admin','Marketing Manager'],session);
      if(site.verificationStatus!=='verified')fail(409,'VERIFY_WEBSITE','Verify this website before publishing schema.');
      const cms=await CmsConnection.findOne({orgId:site.orgId,websiteId:site._id,status:'connected'}).session(session);
      if(!cms||cms.origin!=='https://'+site.domain)fail(409,'CMS_DISCONNECTED','Connect the verified WordPress website first.');
      const schema:any=await SeoSchemaDraft.findOne({_id:p.schemaId,orgId:site.orgId,websiteId:site._id}).session(session);
      if(!schema)fail(404,'NOT_FOUND','Schema draft unavailable.');
      if(schema.version!==d.version)fail(409,'VERSION_CONFLICT','Schema changed. Reload it.');
      if(schema.status!=='approved')fail(409,'SCHEMA_APPROVAL_REQUIRED','Only an independently approved schema can be published.');
      if(!sameHost(schema.url,site.domain))fail(409,'DOMAIN_CHANGED','Update the schema draft for the current website domain.');
      const item:any=await ContentItem.findOne({_id:d.contentId,orgId:site.orgId,websiteId:site._id,version:d.contentVersion,status:'published',remoteOrigin:cms.origin,remoteId:{$type:'number'}}).session(session);
      if(!item)fail(409,'PUBLISH_TARGET_CHANGED','Choose a currently published WordPress page from this website.');
      const schemaUrl=new URL(schema.url),targetUrl=new URL(item.liveUrl);
      if(schemaUrl.origin!==targetUrl.origin||schemaUrl.pathname.replace(/\/+$/,'')!==targetUrl.pathname.replace(/\/+$/,''))fail(422,'SCHEMA_TARGET_MISMATCH','Schema URL must match the selected published page URL.');
      const before=schema.toObject();
      const [job]=await PublishJob.create([{orgId:site.orgId,websiteId:site._id,contentId:item._id,revision:item.publishedRevision||item.revision,contentVersion:item.version,operation:'schema',schemaId:schema._id,schemaVersion:schema.version+1,remoteId:item.remoteId,requestedBy:req.user._id,connectionVersion:cms.version,websiteVersion:site.version,status:'queued',runAt:new Date(),version:0,key:'schema:'+String(schema._id)+':'+schema.version+':'+randomUUID()}],{session});
      schema.status='publishing';schema.version++;schema.publicationJobId=job._id;schema.updatedBy=req.user._id;await schema.save({session});
      await log(session,req,String(site.orgId),'seo.schema.publication_queued','seo_schema',schema._id,before,{...schema.toObject(),reason:d.reason,jobId:job._id});
      return {job,schema};
    });
  }
  @Get('issues') async issues(@Req() req:any,@Param() p:any,@Query() query:unknown){
    const site=await scope(req,p.orgId,p.websiteId),q=parse(issueQuery,query);
    const job:any=await CrawlJob.findOne({_id:q.jobId,orgId:site.orgId,websiteId:site._id}).lean();
    if(!job)fail(404,'NOT_FOUND','Crawl unavailable.');
    const match:any={orgId:site.orgId,websiteId:site._id,jobId:job._id};
    if(q.severity)match.severity=q.severity;
    if(q.search)match.url={$regex:q.search.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'};
    const post:any={};if(q.status)post['workflow.status']=q.status;
    if(q.assigneeId){const mongoose=await import('mongoose');post['workflow.assigneeId']=new mongoose.Types.ObjectId(q.assigneeId);}
    const result=await TechnicalIssue.aggregate([{$match:match},{$lookup:{from:'seo_issue_workflows',let:{issue:'$_id',org:'$orgId',site:'$websiteId'},pipeline:[{$match:{$expr:{$and:[{$eq:['$issueId','$$issue']},{$eq:['$orgId','$$org']},{$eq:['$websiteId','$$site']}]}}}],as:'workflow'}},{$set:{workflow:{$ifNull:[{$arrayElemAt:['$workflow',0]},{status:'open',version:0,assigneeId:null}]}}},{$match:post},{$sort:{_id:-1}},{$facet:{items:[{$skip:(q.page-1)*q.limit},{$limit:q.limit}],count:[{$count:'total'}]}}]);
    return {items:result[0].items,total:result[0].count[0]?.total||0,page:q.page,limit:q.limit};
  }
  @Get('schema') async schemas(@Req() req:any,@Param() p:any){await scope(req,p.orgId,p.websiteId);return {items:await SeoSchemaDraft.find({orgId:p.orgId,websiteId:p.websiteId}).sort({_id:-1}).limit(100).lean()};}
  @Post('schema') async createSchema(@Req() req:any,@Param() p:any,@Body() body:unknown){return this.saveSchema(req,p,body);}
  @Post('schema/:schemaId') async editSchema(@Req() req:any,@Param() p:any,@Body() body:unknown){recordId(p.schemaId);return this.saveSchema(req,p,body);}
  private async saveSchema(req:any,p:any,body:unknown){
    const d=parse(schemaDto,body);
    return transaction(async session=>{
      const site=await scope(req,p.orgId,p.websiteId,writers,session);
      if(!sameHost(d.jsonLd.url,site.domain))fail(422,'OUT_OF_SCOPE','Schema URL must belong to this website.');
      let item:any=p.schemaId?await SeoSchemaDraft.findOne({_id:p.schemaId,orgId:p.orgId,websiteId:p.websiteId}).session(session):null;
      if(p.schemaId&&!item)fail(404,'NOT_FOUND','Schema draft unavailable.');
      if(item?.status==='publishing')fail(409,'SCHEMA_PUBLICATION_PENDING','Wait for the WordPress schema job to finish or reconcile.');
      if(item&&item.version!==d.version)fail(409,'VERSION_CONFLICT','Schema changed. Reload it.');
      if(!item&&d.version!==undefined)fail(422,'INVALID_VERSION','New drafts do not take a version.');
      const before=item?.toObject()||null;
      if(!item)item=new SeoSchemaDraft({orgId:p.orgId,websiteId:p.websiteId});
      item.name=d.name;item.url=d.jsonLd.url;item.jsonLd=d.jsonLd;item.status='draft';item.approvedBy=undefined;item.updatedBy=req.user._id;if(before)item.version++;
      await item.save({session});await log(session,req,p.orgId,'seo.schema.saved','seo_schema',item._id,before,item.toObject());return item;
    });
  }
  @Post('schema/:schemaId/transition') async schemaTransition(@Req() req:any,@Param() p:any,@Body() body:unknown){
    recordId(p.schemaId);const d=parse(z.object({version:z.number().int().nonnegative(),action:z.enum(['review','approve','archive']),reason:z.string().trim().min(3).max(1000)}).strict(),body);
    return transaction(async session=>{
      const site=await scope(req,p.orgId,p.websiteId,d.action==='approve'?['Owner','Admin','Marketing Manager']:writers,session);
      const item:any=await SeoSchemaDraft.findOne({_id:p.schemaId,orgId:p.orgId,websiteId:p.websiteId}).session(session);
      if(!item)fail(404,'NOT_FOUND','Schema unavailable.');if(item.version!==d.version)fail(409,'VERSION_CONFLICT','Schema changed. Reload it.');
      if(item.status==='publishing')fail(409,'SCHEMA_PUBLICATION_PENDING','Wait for the WordPress schema job to finish or reconcile.');if(d.action==='review'&&item.status!=='draft'||d.action==='approve'&&item.status!=='review')fail(409,'INVALID_TRANSITION','Reload the current schema workflow.');
      if(d.action==='approve'&&String(item.updatedBy)===String(req.user._id))fail(409,'INDEPENDENT_REVIEW_REQUIRED','Another approver must review this schema.');
      if(!sameHost(item.url,site.domain))fail(409,'DOMAIN_CHANGED','Update this draft for the current website domain.');
      parse(schemaDto,{name:item.name,jsonLd:item.jsonLd});const before=item.toObject();item.status=d.action==='approve'?'approved':d.action==='archive'?'archived':'review';if(d.action==='approve')item.approvedBy=req.user._id;item.version++;await item.save({session});
      await log(session,req,p.orgId,'seo.schema.'+d.action,'seo_schema',item._id,before,{...item.toObject(),reason:d.reason});return item;
    });
  }
  @Get('issues/:issueId') async issue(@Req() req:any,@Param() p:any){
    await scope(req,p.orgId,p.websiteId);recordId(p.issueId);
    const filter={orgId:p.orgId,websiteId:p.websiteId};
    const evidence=await TechnicalIssue.findOne({...filter,_id:p.issueId}).lean();
    if(!evidence)fail(404,'NOT_FOUND','Issue unavailable.');
    const workflow=await SeoIssueWorkflow.findOne({...filter,issueId:p.issueId}).lean();
    const members=await Membership.find({orgId:p.orgId,status:'active'}).select('userId').limit(200).lean();
    const assignees=await User.find({_id:{$in:members.map(m=>m.userId)}}).select('_id name').lean();
    return {evidence,assignees,workflow:workflow||{status:'open',version:0,assigneeId:null,reason:''}};
  }
  @Post('issues/:issueId/transition') async change(@Req() req:any,@Param() p:any,@Body() body:unknown){
    const dto=parse(transition,body);recordId(p.issueId);
    return transaction(async session=>{
      const site=await scope(req,p.orgId,p.websiteId,writers,session);
      const filter={orgId:p.orgId,websiteId:p.websiteId};
      const evidence:any=await TechnicalIssue.findOne({...filter,_id:p.issueId}).session(session).lean();
      if(!evidence)fail(404,'NOT_FOUND','Issue unavailable.');
      let item:any=await SeoIssueWorkflow.findOne({...filter,issueId:p.issueId}).session(session);
      if((item?.version||0)!==dto.version)fail(409,'VERSION_CONFLICT','Issue workflow changed. Reload it.');
      if(dto.assigneeId&&!await Membership.exists({orgId:p.orgId,userId:dto.assigneeId,status:'active'}).session(session))fail(422,'INVALID_ASSIGNEE','Choose an active workspace member.');
      const before=item?.toObject()||null;
      if(!item)item=new SeoIssueWorkflow({...filter,issueId:p.issueId});
      if(dto.action==='recheck'){
        const original:any=await CrawlJob.findOne({...filter,_id:evidence.jobId}).session(session).lean();
        if(original?.domain!==site.domain)fail(409,'DOMAIN_CHANGED','This evidence belongs to a previous website domain.');
        if(!original?.completedAt)fail(409,'EVIDENCE_UNAVAILABLE','Wait for the original crawl to finish.');
        const job:any=await CrawlJob.findOne({...filter,domain:site.domain,status:{$in:['completed','completed_with_errors']},startedAt:{$gt:original.completedAt}}).sort({completedAt:-1,_id:-1}).session(session).lean();
        if(!job)fail(409,'RECHECK_REQUIRED','Run a new crawl before rechecking this issue.');
        const page=await CrawlPage.findOne({...filter,jobId:job._id,url:evidence.url}).session(session).lean();
        const present=!!await TechnicalIssue.exists({...filter,jobId:job._id,url:evidence.url,type:evidence.type}).session(session);
        item.status=canResolve(job,page,present)?'resolved':'open';item.checkedJobId=job._id;item.checkedAt=new Date();
      }else item.status=dto.action;
      item.assigneeId=dto.assigneeId;item.reason=dto.reason;item.updatedBy=req.user._id;item.version+=1;
      await item.save({session});
      await log(session,req,p.orgId,'seo.issue.'+dto.action,'seo_issue',p.issueId,before,item.toObject());
      return item;
    });
  }
  @Get('providers') async providers(@Req() req:any,@Param() p:any){
    const site=await scope(req,p.orgId,p.websiteId);
    const rows=await SeoProviderConnection.find({orgId:site.orgId,websiteId:site._id}).select('provider status property version updatedAt').lean();
    const byKey=new Map(rows.map((row:any)=>[row.provider,row]));
    return {items:seoProviderCatalog.map(provider=>{const saved:any=byKey.get(provider.key);return {key:provider.key,label:provider.label,data:provider.data,connection:provider.connection,status:saved?.status||'disconnected',property:saved?.property||null,version:saved?.version??null,updatedAt:saved?.updatedAt||null,metricsAvailable:saved?.status==='connected'};})};
  }
  @Post('providers/:provider/connect') async requestProviderAuthorization(@Req() req:any,@Param() p:any,@Body() body:unknown){
    const provider=parse(z.enum(['search_console','rankings','ai_visibility']),p.provider);
    const d=parse(z.object({property:z.string().trim().min(2).max(255).optional(),version:z.number().int().nonnegative().optional()}).strict(),body);
    return transaction(async session=>{
      const site=await scope(req,p.orgId,p.websiteId,writers,session);
      let item:any=await SeoProviderConnection.findOne({orgId:site.orgId,websiteId:site._id,provider}).session(session);
      if(item&&d.version!==item.version)fail(409,'VERSION_CONFLICT','Provider connection changed. Reload it.');
      if(!item&&d.version!==undefined)fail(422,'INVALID_VERSION','New connection requests do not take a version.');
      const before=item?.toObject()||null;
      if(!item)item=new SeoProviderConnection({orgId:site.orgId,websiteId:site._id,provider,updatedBy:req.user._id});
      item.status='authorization_required';item.property=d.property;item.requestedBy=req.user._id;item.updatedBy=req.user._id;if(before)item.version++;
      await item.save({session});await log(session,req,String(site.orgId),'seo.provider.authorization_requested','seo_provider_connection',item._id,before,item);
      return {key:provider,status:item.status,property:item.property||null,version:item.version,notice:'Authorization is not connected yet. No provider data is available until a verified provider authorization flow is configured.'};
    });
  }
  @Post('providers/:provider/disconnect') async disconnectProvider(@Req() req:any,@Param() p:any,@Body() body:unknown){
    const provider=parse(z.enum(['search_console','rankings','ai_visibility']),p.provider);
    const d=parse(z.object({version:z.number().int().nonnegative(),reason:z.string().trim().min(3).max(500)}).strict(),body);
    return transaction(async session=>{
      const site=await scope(req,p.orgId,p.websiteId,writers,session);
      const item:any=await SeoProviderConnection.findOne({orgId:site.orgId,websiteId:site._id,provider}).session(session);
      if(!item)fail(404,'NOT_FOUND','Provider connection unavailable.');
      if(item.version!==d.version)fail(409,'VERSION_CONFLICT','Provider connection changed. Reload it.');
      const before=item.toObject();item.status='disconnected';item.property=undefined;item.version++;item.updatedBy=req.user._id;
      await item.save({session});await log(session,req,String(site.orgId),'seo.provider.disconnected','seo_provider_connection',item._id,before,{...item.toObject(),reason:d.reason});
      return {key:provider,status:item.status,version:item.version};
    });
  }
  @Get('summary') async summary(@Req() req:any,@Param() p:any) {
    const site=await scope(req,p.orgId,p.websiteId);
    // Use one finished snapshot, never blend stale inventory with an active crawl.
    const job:any=await CrawlJob.findOne({orgId:p.orgId,websiteId:p.websiteId,domain:site.domain,status:{$in:['completed','completed_with_errors']}}).sort({completedAt:-1,_id:-1}).lean();
    const providers={searchConsole:'not_connected',rankings:'not_connected',aiVisibility:'not_connected'};
    if(!job)return {crawl:null,auditedPages:0,indexable:0,notIndexable:0,unknown:0,issues:[],providers};
    const filter={orgId:site.orgId,websiteId:site._id,jobId:job._id};
    const [auditedPages,indexable,notIndexable,issues]=await Promise.all([
      CrawlPage.countDocuments(filter),
      CrawlPage.countDocuments({...filter,status:'crawled','data.indexable':true}),
      CrawlPage.countDocuments({...filter,status:'crawled','data.indexable':false}),
      TechnicalIssue.aggregate([{$match:filter},{$group:{_id:{type:'$type',severity:'$severity'},count:{$sum:1},why:{$first:'$why'},recommendation:{$first:'$recommendation'}}},{$sort:{count:-1,'_id.type':1}}])
    ]);
    return {crawl:{id:job._id,status:job.status,completedAt:job.completedAt,truncated:!!job.truncated,mode:job.config?.mode},auditedPages,indexable,notIndexable,unknown:auditedPages-indexable-notIndexable,issues:issues.map(i=>({type:i._id.type,severity:i._id.severity,count:i.count,why:i.why,recommendation:i.recommendation})),providers};
  }
}
