import {Controller,Get,Param,Req,UseGuards} from '@nestjs/common';
import {AuthGuard,VerifiedGuard} from '../security';
import {scope} from '../content/scope';
import {CrawlJob,CrawlPage,TechnicalIssue} from '../crawler/models';

@Controller('organizations/:orgId/websites/:websiteId/seo')
@UseGuards(AuthGuard,VerifiedGuard)
export class SeoController {
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
