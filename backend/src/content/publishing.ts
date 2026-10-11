import {Queue,Worker} from 'bullmq';
import {redisConnection} from '../crawler/queue';
import {ContentItem,CmsConnection,PublishJob} from './models';
import {User,transaction,log} from '../database';
import {scope,publishers} from './scope';
import {renderBlocks} from './contracts';
import {wordpress,cmsError} from './wordpress';
export const publicationMarker=(id:unknown,revision:number)=>`<!-- growth-os:${id}:revision:${revision} -->`;
let queue:Queue|undefined;
const jobs=()=>queue ||= new Queue('growth-publishing',{connection:redisConnection(),defaultJobOptions:{attempts:1,removeOnComplete:{count:100},removeOnFail:{count:100}}});
export async function processPublication(id:string){
 const job=await PublishJob.findOneAndUpdate({_id:id,status:'queued',runAt:{$lte:new Date()}},{$set:{status:'running',startedAt:new Date()},$inc:{attempts:1,version:1}},{new:true});if(!job)return;
 let req:any,item:any,connection:any,mutationAttempted=false;
 try{
  await transaction(async session=>{
   const user=await User.findOne({_id:job.requestedBy,status:'active',emailVerifiedAt:{$ne:null}}).session(session);if(!user)throw Error('CMS_PERMISSION_CHANGED');req={user,requestId:'publish-'+String(job._id)};
   const site=await scope(req,String(job.orgId),String(job.websiteId),publishers,session);if(site.version!==job.websiteVersion||site.verificationStatus!=='verified')throw Error('CMS_WEBSITE_CHANGED');
   connection=await CmsConnection.findOne({orgId:job.orgId,websiteId:job.websiteId,status:'connected',version:job.connectionVersion}).select('+encryptedSecret').session(session);if(!connection||connection.origin!=='https://'+site.domain)throw Error('CMS_CONNECTION_CHANGED');
   item=await ContentItem.findOne({_id:job.contentId,orgId:job.orgId,websiteId:job.websiteId,revision:job.revision,approvedRevision:job.revision,status:'scheduled'}).session(session);if(!item)throw Error('CMS_APPROVAL_CHANGED');if(item.remoteId&&item.remoteOrigin!==connection.origin)throw Error('CMS_REMOTE_ORIGIN_CHANGED');item.status='publishing';item.version++;await item.save({session});
  });
  const endpoint=item.type==='page'?'pages':'posts',marker=publicationMarker(item._id,job.revision);
  let remote:any;
  if(item.remoteId){remote=await wordpress(connection,endpoint+'/'+item.remoteId+'?context=edit');if(remote.modified_gmt!==item.remoteModified)throw Error('CMS_REMOTE_CONFLICT');}
  else{
   const found=await wordpress(connection,endpoint+'?context=edit&slug='+encodeURIComponent(item.slug));
   if(found.length){remote=found.find((r:any)=>String(r.content?.raw||'').includes(marker));if(!remote)throw Error('CMS_SLUG_CONFLICT');}
  }
  // Creation is always a remote draft. Never blindly repeat a timed-out POST.
  const payload={title:item.title,slug:item.slug,content:renderBlocks(item.blocks)+'\n'+marker,excerpt:item.description,categories:item.type==='post'?item.categories:undefined,tags:item.type==='post'?item.tags:undefined,status:job.operation==='publish'&&remote?'publish':'draft'};
  if(remote?.status==='publish'&&job.operation==='draft')throw Error('CMS_PUBLISHED_DRAFT_FORBIDDEN');
  mutationAttempted=true;
  if(!remote)remote=await wordpress(connection,endpoint,'POST',payload);
  else remote=await wordpress(connection,endpoint+'/'+remote.id,'POST',payload);
  if(!Number.isInteger(remote.id)||!remote.modified_gmt)throw Error('CMS_OUTCOME_UNKNOWN');
  await PublishJob.updateOne({_id:job._id},{$set:{remoteId:remote.id}});
  if(job.operation==='publish'&&remote.status!=='publish')remote=await wordpress(connection,endpoint+'/'+remote.id,'POST',{status:'publish'});
  if(remote.status!==(job.operation==='publish'?'publish':'draft'))throw Error('CMS_OUTCOME_UNKNOWN');
  await transaction(async session=>{
   const before=await ContentItem.findById(item._id).session(session);
   const saved=await ContentItem.findOneAndUpdate({_id:item._id,orgId:job.orgId,websiteId:job.websiteId,revision:job.revision,status:'publishing'},{$set:{status:job.operation==='publish'?'published':'approved',remoteId:remote.id,remoteOrigin:connection.origin,remoteModified:remote.modified_gmt,liveUrl:remote.link,publishedRevision:job.operation==='publish'?job.revision:undefined},$inc:{version:1}},{new:true,session});if(!saved)throw Error('CMS_LOCAL_CONFLICT');
   await PublishJob.updateOne({_id:job._id},{$set:{status:'completed',remoteId:remote.id,finishedAt:new Date()},$inc:{version:1}},{session});await log(session,req,String(job.orgId),'content.synced','content',item._id,before,saved);
  });
 }catch(e){const error=cmsError(e);await transaction(async session=>{await PublishJob.updateOne({_id:job._id},{$set:{status:mutationAttempted?'needs_review':'failed',error,finishedAt:new Date()},$inc:{version:1}},{session});await ContentItem.updateOne({_id:job.contentId,orgId:job.orgId,websiteId:job.websiteId,revision:job.revision,status:{$in:['scheduled','publishing']}},{$set:{status:'approved'},$inc:{version:1}},{session});await log(session,req||{user:{_id:job.requestedBy},requestId:'publish-'+job._id},String(job.orgId),'publish.failed','publish_job',job._id,null,{websiteId:job.websiteId,error,uncertain:mutationAttempted});});}
}
export async function startPublishingWorker(){
 const worker=new Worker('growth-publishing',async j=>processPublication(String(j.data.id)),{connection:redisConnection(),concurrency:1,maxStalledCount:0});worker.on('error',()=>console.error('Publishing queue unavailable'));
 let busy=false;const dispatch=async()=>{if(busy)return;busy=true;try{
  // Interrupted external mutations are never replayed automatically.
  const stale=await PublishJob.find({status:'running',startedAt:{$lt:new Date(Date.now()-10*60000)}}).limit(100);
  for(const j of stale){await PublishJob.updateOne({_id:j._id,status:'running'},{$set:{status:'needs_review',error:'CMS_OUTCOME_UNKNOWN'}});await ContentItem.updateOne({_id:j.contentId,status:'publishing'},{$set:{status:'approved'},$inc:{version:1}});}
  for(const j of await PublishJob.find({status:'queued',runAt:{$lte:new Date()}}).limit(100))await jobs().add('publish',{id:String(j._id)},{jobId:String(j._id)});
 }catch{console.error('Publishing dispatch unavailable');}finally{busy=false;}};
 const timer=setInterval(dispatch,5000);await dispatch();return async()=>{clearInterval(timer);await worker.close();await queue?.close();queue=undefined;};
}
