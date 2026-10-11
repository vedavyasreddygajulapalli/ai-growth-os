import {z} from 'zod';
import {parse,recordId,fail,id} from '../contracts';
import {transaction,log,Membership,User} from '../database';
import {SeoIssueWorkflow} from './models';
import {canResolve} from './recheck';
const writers=['Owner','Admin','Marketing Manager','SEO Manager'];
const transition=z.object({version:z.number().int().nonnegative(),action:z.enum(['open','in_progress','ignored','recheck']),assigneeId:id.nullable(),reason:z.string().trim().min(3).max(1000)}).strict();
import {Controller,Get,Post,Body,Param,Req,UseGuards} from '@nestjs/common';
import {AuthGuard,VerifiedGuard} from '../security';
import {scope} from '../content/scope';
import {CrawlJob,CrawlPage,TechnicalIssue} from '../crawler/models';

@Controller('organizations/:orgId/websites/:websiteId/seo')
@UseGuards(AuthGuard,VerifiedGuard)
export class SeoController {
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
