import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {MongoMemoryReplSet} from "mongodb-memory-server";
import mongoose from "mongoose";
import {createApp} from "../src/app";
import {connectDatabase,User,Session,Organization,Membership,Website,Audit} from "../src/database";
import {runMigrations} from "../src/migrations";
import {digest} from "../src/security";
import {KnowledgeRecord} from "../src/knowledge/models";
process.env.NODE_ENV="test";process.env.APP_ORIGINS="http://localhost:3000";
let db:MongoMemoryReplSet,app:any,base:string,org:string,site:string,otherSite:string,claim:any;
before(async()=>{
 db=await MongoMemoryReplSet.create({binary:{version:"7.0.24"},replSet:{count:1}});await connectDatabase(db.getUri());await runMigrations();
 const o=await Organization.create({name:"Test workspace",timezone:"UTC",currency:"USD"});org=String(o._id);
 for(const [name,role] of [["owner","Owner"],["viewer","Viewer"],["writer","Content Writer"],["outsider",null]]){
  const u=await User.create({name,email:name+"@example.com",passwordHash:"unused",emailVerifiedAt:new Date()});
  await Session.create({userId:u._id,tokenHash:digest(name!),expiresAt:new Date(Date.now()+600000)});
  if(role)await Membership.create({orgId:org,userId:u._id,role});
 }
 site=String((await Website.create({orgId:org,name:"Test site",domain:"example.com",cmsType:"WordPress",verificationStatus:"verified",verificationToken:"test"}))._id);
 otherSite=String((await Website.create({orgId:org,name:"Second site",domain:"second.example.com",cmsType:"WordPress",verificationStatus:"verified",verificationToken:"test"}))._id);
 app=await createApp();await app.listen(0,"127.0.0.1");base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/organizations/${org}/websites/`;
});
after(async()=>{await app?.close();await mongoose.disconnect();await db?.stop();});
async function call(suffix:string,method="GET",body?:any,actor="owner",website=site){
 const r=await fetch(base+website+suffix,{method,headers:{Origin:"http://localhost:3000","X-Growth-Client":"web","Content-Type":"application/json",Cookie:"growth_session="+actor},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
}

import {randomUUID} from 'node:crypto';
import {ContentItem,ContentVersion,CmsConnection,PublishJob} from '../src/content/models';
import {setTestWpTransport} from '../src/content/wordpress';
import {processPublication,publicationMarker} from '../src/content/publishing';
process.env.CRAWLER_ENABLED='true';process.env.REDIS_URL='redis://localhost:6379';
async function makeApproved(slug:string){let r=await call('/content','POST',{title:'Test '+slug,slug,type:'post',blocks:[{type:'paragraph',text:'Approved body'}],idempotencyKey:randomUUID()});assert.equal(r.status,201,JSON.stringify(r.data));
 for(const action of ['draft','review','approve']){if(action==='approve')assert.equal((await call('/content/'+r.data._id+'/transition','POST',{action,version:r.data.version})).status,403);r=await call('/content/'+r.data._id+'/transition','POST',{action,version:r.data.version,...(action==='approve'?{allowSelfApproval:true,reason:'Owner accepts this test revision'}:{})});assert.equal(r.status,201,JSON.stringify(r.data));}return r.data;}
test('content persistence, one-time create, version history and tenant permissions',async()=>{
 const body={title:'Content test',slug:'content-test',type:'post',idempotencyKey:randomUUID()};
 assert.equal((await call('/content','POST',body,'viewer')).status,403);
 const r=await call('/content','POST',body);assert.equal(r.status,201,JSON.stringify(r.data));
 assert.equal((await call('/content','POST',body)).data._id,r.data._id);
 assert.equal((await call('/content/'+r.data._id,'GET',undefined,'owner',otherSite)).status,404);
 assert.equal((await call('/content/'+r.data._id,'GET',undefined,'outsider')).status,404);
 const update={title:'Changed',slug:'content-test',type:'post',version:r.data.version};
 assert.equal((await call('/content/'+r.data._id,'PATCH',update)).status,200);
 assert.equal((await call('/content/'+r.data._id,'PATCH',update)).status,409);
 assert.equal(await ContentVersion.countDocuments({contentId:r.data._id}),2);
});
test('approval is revision bound and queued content is locked until cancellation',async()=>{
 const item=await makeApproved('approval');
 await CmsConnection.create({orgId:org,websiteId:site,status:'connected',origin:'https://example.com',version:0,capabilities:{publish:true}});
 assert.equal((await call('/cms/'+item._id+'/publish','POST',{version:item.version,operation:'publish'},'writer')).status,403);
 const queued=await call('/cms/'+item._id+'/publish','POST',{version:item.version,operation:'publish'});assert.equal(queued.status,201,JSON.stringify(queued.data));
 assert.equal((await call('/content/'+item._id,'PATCH',{title:'Changed',slug:item.slug,type:'post',version:item.version+1})).status,409);
 assert.equal((await call('/cms/jobs/'+queued.data._id+'/cancel','POST',{version:queued.data.version})).status,201);
 const updated=await call('/content/'+item._id,'PATCH',{title:'Changed',slug:item.slug,type:'post',version:item.version+2});assert.equal(updated.status,200,JSON.stringify(updated.data));
 assert.equal(updated.data.approvedRevision,undefined);
 assert.equal((await call('/cms/'+item._id+'/publish','POST',{version:updated.data.version,operation:'publish'})).status,409);
});
test('unknown publishing outcome is reconciled without repeating a remote mutation',async()=>{
 const item=await makeApproved('uncertain');let remote:any,posts=0;
 setTestWpTransport(async(_c,path,method,body)=>{if(method==='POST'){posts++;remote={id:101,content:{raw:body.content},status:'draft',modified_gmt:'2026-10-11T00:00:00',link:'https://example.com/post'};throw Error('CMS_OUTCOME_UNKNOWN');}return path.includes('slug=')?(remote?[remote]:[]):remote;});
 const queued=await call('/cms/'+item._id+'/publish','POST',{version:item.version,operation:'publish'});assert.equal(queued.status,201,JSON.stringify(queued.data));await processPublication(queued.data._id);
 assert.equal((await PublishJob.findById(queued.data._id))!.status,'needs_review');assert.equal(posts,1);
 const current:any=await ContentItem.findById(item._id);
 assert.equal((await call('/cms/'+item._id+'/publish','POST',{version:current.version,operation:'publish'})).status,409);
 const check=await call('/cms/jobs/'+queued.data._id+'/reconcile','POST',{});assert.equal(check.status,201,JSON.stringify(check.data));assert.equal(posts,1);
 assert.equal((await ContentItem.findById(item._id))!.remoteId,101);
 assert.equal((await PublishJob.findById(queued.data._id))!.status,'reconciled');setTestWpTransport();
});
test('draft sync cannot unpublish a remote post and revoked membership prevents writes',async()=>{
 const item=await makeApproved('live-post');await ContentItem.updateOne({_id:item._id},{$set:{remoteId:123,remoteOrigin:'https://example.com',remoteModified:'known'}});let writes=0;
 setTestWpTransport(async(_c,_p,method)=>{if(method==='POST')writes++;return {id:123,status:'publish',modified_gmt:'known',content:{raw:publicationMarker(item._id,item.revision)}};});
 const q=await call('/cms/'+item._id+'/publish','POST',{version:item.version,operation:'draft'});assert.equal(q.status,201);await processPublication(q.data._id);
 assert.equal(writes,0);assert.equal((await PublishJob.findById(q.data._id))!.error,'CMS_PUBLISHED_DRAFT_FORBIDDEN');
 const current:any=await ContentItem.findById(item._id);const q2=await call('/cms/'+item._id+'/publish','POST',{version:current.version,operation:'publish'});assert.equal(q2.status,201);
 const owner=await User.findOne({email:'owner@example.com'});await Membership.updateOne({orgId:org,userId:owner!._id},{$set:{role:'Viewer'}});await processPublication(q2.data._id);assert.equal(writes,0);assert.equal((await PublishJob.findById(q2.data._id))!.status,'failed');
 await Membership.updateOne({orgId:org,userId:owner!._id},{$set:{role:'Owner'}});setTestWpTransport();
});
import {setTestDraftProvider} from '../src/content/ai';
test('AI proposal requires explicit version-fenced application and cannot be reused',async()=>{
 const item=await makeApproved('ai-proposal');setTestDraftProvider(async()=> 'Review this suggested paragraph.');
 const proposal=await call('/content/'+item._id+'/ai','POST',{version:item.version,operation:'rewrite',instruction:'Make it concise'});assert.equal(proposal.status,201,JSON.stringify(proposal.data));
 assert.equal((await ContentItem.findById(item._id))!.status,'approved');
 const applied=await call('/content/'+item._id+'/ai/'+proposal.data.id+'/apply','POST',{version:item.version});assert.equal(applied.status,201,JSON.stringify(applied.data));assert.equal(applied.data.status,'draft');assert.equal(applied.data.approvedRevision,undefined);
 assert.equal((await call('/content/'+item._id+'/ai/'+proposal.data.id+'/apply','POST',{version:applied.data.version})).status,409);setTestDraftProvider();
});

test('remote import is persisted, idempotent and requires explicit formatting acceptance',async()=>{
 setTestWpTransport(async()=>({id:250,slug:'remote-import',title:{raw:'Remote article'},content:{raw:'<p>Actual remote content</p>'},modified_gmt:'2026-10-11T00:00:00',link:'https://example.com/remote-import'}));
 const body={remoteId:250,type:'post',acceptSimplifiedFormatting:true};
 assert.equal((await call('/cms/import','POST',body,'viewer')).status,403);
 assert.equal((await call('/cms/import','POST',{remoteId:250,type:'post'})).status,422);
 const r=await call('/cms/import','POST',body);assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.status,'draft');assert.equal(r.data.remoteOrigin,'https://example.com');
 assert.equal((await call('/cms/import','POST',body)).data._id,r.data._id);assert.equal(await ContentVersion.countDocuments({contentId:r.data._id}),1);setTestWpTransport();
});
import {ensureFeaturedMedia} from '../src/content/media';
import {CmsMedia} from '../src/content/models';
test('featured images use private scoped bytes, deduplicate and reconcile a lost upload response',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
 const asset=await call('/knowledge/upload','POST',{name:'cover.png',type:'image/png',base64:png.toString('base64')});assert.equal(asset.status,201,JSON.stringify(asset.data));
 const c:any={orgId:org,websiteId:site,origin:'https://example.com',capabilities:{media:true}};let remote:any,uploads=0;
 setTestWpTransport(async(_c,path,method,body)=>{if(method==='POST'){uploads++;assert.deepEqual(body.bytes,png);remote={id:901,slug:body.filename.replace(/\.png$/,''),mime_type:'image/png'};throw Error('CMS_OUTCOME_UNKNOWN');}return remote?[remote]:[];});
 await assert.rejects(()=>ensureFeaturedMedia(c,asset.data._id),/CMS_MEDIA_OUTCOME_UNKNOWN/);assert.equal(uploads,1);
 assert.equal((await CmsMedia.findOne({orgId:org,websiteId:site}))!.status,'needs_review');
 assert.equal(await ensureFeaturedMedia(c,asset.data._id),901);assert.equal(await ensureFeaturedMedia(c,asset.data._id),901);assert.equal(uploads,1);
 await assert.rejects(()=>ensureFeaturedMedia({...c,websiteId:otherSite},asset.data._id),/CMS_MEDIA_UNAVAILABLE/);
 await assert.rejects(()=>ensureFeaturedMedia({...c,capabilities:{media:false}},asset.data._id),/CMS_MEDIA_PERMISSION_REQUIRED/);
 const item=await makeApproved('cover-content');
 const edited=await call('/content/'+item._id,'PATCH',{title:item.title,slug:item.slug,type:'post',blocks:item.blocks,featuredMediaId:asset.data._id,version:item.version});assert.equal(edited.status,200);assert.equal(edited.data.approvedRevision,undefined);
 assert.equal((await call('/content/'+item._id,'PATCH',{title:item.title,slug:item.slug,type:'post',featuredMediaId:asset.data._id,version:edited.data.version},'owner',otherSite)).status,404);
 await CmsConnection.updateOne({orgId:org,websiteId:site},{$set:{'capabilities.media':true}});
 let reviewed=await call('/content/'+item._id+'/transition','POST',{action:'review',version:edited.data.version});
 reviewed=await call('/content/'+item._id+'/transition','POST',{action:'approve',version:reviewed.data.version,allowSelfApproval:true,reason:'Owner reviews the cover image'});assert.equal(reviewed.status,201);
 let sent:any;
 setTestWpTransport(async(_c,path,method,body)=>{if(method==='POST'){sent={...(sent||{}),...body};return {id:902,status:sent.status,featured_media:sent.featured_media,modified_gmt:'2026-10-11T01:00:00',link:'https://example.com/cover-content'};}return [];});
 const queued=await call('/cms/'+item._id+'/publish','POST',{version:reviewed.data.version,operation:'publish'});assert.equal(queued.status,201);await processPublication(queued.data._id);
 assert.equal(sent.featured_media,901);assert.equal((await PublishJob.findById(queued.data._id))!.status,'completed');
 setTestWpTransport();
});
test('refresh opens a new draft revision and retains live mapping without a remote write',async()=>{
 const item=await makeApproved('refresh-live');await ContentItem.updateOne({_id:item._id},{$set:{status:'published',remoteId:701,remoteOrigin:'https://example.com',publishedRevision:item.revision}});
 const result=await call('/content/'+item._id+'/refresh','POST',{version:item.version,reason:'Update product details'});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.status,'draft');assert.equal(result.data.remoteId,701);assert.equal(result.data.revision,item.revision+1);assert.equal(result.data.approvedRevision,undefined);
 assert.equal((await call('/content/'+item._id+'/refresh','POST',{version:item.version,reason:'Retry'})).status,409);
 assert.equal((await call('/content/refresh-candidates?days=0')).status,422);
});
