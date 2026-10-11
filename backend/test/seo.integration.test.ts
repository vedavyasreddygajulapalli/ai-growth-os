import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {MongoMemoryReplSet} from "mongodb-memory-server";
import mongoose from "mongoose";
import {createApp} from "../src/app";
import {connectDatabase,User,Session,Organization,Membership,Website,Audit} from "../src/database";
import {runMigrations} from "../src/migrations";
import {digest} from "../src/security";
import {SeoProviderConnection,SeoSchemaDraft} from "../src/seo/models";
import {ContentItem,CmsConnection,PublishJob} from "../src/content/models";
import {processPublication} from "../src/content/publishing";
import {setTestWpTransport} from "../src/content/wordpress";
process.env.NODE_ENV="test";process.env.APP_ORIGINS="http://localhost:3000";process.env.CRAWLER_ENABLED="true";process.env.REDIS_URL="redis://localhost:6379";process.env.CMS_SCHEMA_META_KEY="aigrowthos_jsonld";
let db:MongoMemoryReplSet,app:any,base:string,org:string,site:string,otherSite:string;
before(async()=>{
 db=await MongoMemoryReplSet.create({binary:{version:"7.0.24"},replSet:{count:1}});await connectDatabase(db.getUri());await runMigrations();
 const o=await Organization.create({name:"Test workspace",timezone:"UTC",currency:"USD"});org=String(o._id);
 for(const [name,role] of [["owner","Owner"],["seo","SEO Manager"],["viewer","Viewer"],["outsider",null]]){
  const u=await User.create({name,email:name+"@example.com",passwordHash:"unused",emailVerifiedAt:new Date()});
  await Session.create({userId:u._id,tokenHash:digest(name!),expiresAt:new Date(Date.now()+60000)});
  if(role)await Membership.create({orgId:org,userId:u._id,role});
 }
 site=String((await Website.create({orgId:org,name:"Test site",domain:"example.com",cmsType:"Other",verificationToken:"test"}))._id);
 otherSite=String((await Website.create({orgId:org,name:"Second site",domain:"second.example.com",cmsType:"Other",verificationToken:"test"}))._id);
 app=await createApp();await app.listen(0,"127.0.0.1");base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/organizations/${org}/websites/`;
});
after(async()=>{await app?.close();await mongoose.disconnect();await db?.stop();});
async function call(suffix:string,method="GET",body?:any,actor="owner",website=site){
 const r=await fetch(base+website+"/seo"+suffix,{method,headers:{Origin:"http://localhost:3000","X-Growth-Client":"web","Content-Type":"application/json",Cookie:"growth_session="+actor},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
}
test("provider status defaults to disconnected and never supplies invented metrics",async()=>{
 const r=await call("/providers");assert.equal(r.status,200);assert.equal(r.data.items.length,3);
 assert.ok(r.data.items.every((p:any)=>p.status==="disconnected"&&p.metricsAvailable===false));
 assert.equal(r.data.items.find((p:any)=>p.key==="search_console").property,null);
 assert.equal(await SeoProviderConnection.countDocuments({orgId:org,websiteId:site}),0);
});
test("authorization requests are role- and website-scoped, versioned and audited without storing credentials",async()=>{
 const body={property:"sc-domain:example.com"};
 assert.equal((await call("/providers/search_console/connect","POST",body,"viewer")).status,403);
 assert.equal((await call("/providers/search_console/connect","POST",{...body,accessToken:"secret"})).status,422);
 assert.equal((await call("/providers/search_console/connect","POST",body,"seo",otherSite)).status,201);
 const requested=await call("/providers/search_console/connect","POST",body);assert.equal(requested.status,201);
 assert.equal(requested.data.status,"authorization_required");assert.match(requested.data.notice,/not connected yet/i);
 const listed=await call("/providers");const saved=listed.data.items.find((p:any)=>p.key==="search_console");
 assert.equal(saved.status,"authorization_required");assert.equal(saved.property,body.property);assert.equal(saved.metricsAvailable,false);
 assert.equal(await SeoProviderConnection.countDocuments({orgId:org,websiteId:site}),1);
 const disconnected=await call("/providers/search_console/disconnect","POST",{version:saved.version,reason:"Remove unused setup"});
 assert.equal(disconnected.status,201);assert.equal(disconnected.data.status,"disconnected");
 assert.equal(await Audit.countDocuments({orgId:org,entityType:"seo_provider_connection"}),2);
 assert.equal((await call("/providers/search_console/disconnect","POST",{version:0,reason:"Wrong website"},"owner",otherSite)).status,404);
});
test("provider keys and DTOs reject unsupported or cross-tenant requests",async()=>{
 assert.equal((await call("/providers/unknown/connect","POST",{})).status,422);
 assert.equal((await call("/providers")).data.items.length,3);
 assert.equal((await call("/providers","GET",undefined,"outsider")).status,404);
});

test("only independently approved schema can enter a version-bound WordPress publication job",async()=>{
 await CmsConnection.create({orgId:org,websiteId:site,status:"connected",origin:"https://example.com",version:0,capabilities:{publish:true}});
 const content:any=await ContentItem.create({orgId:org,websiteId:site,title:"About",slug:"about",type:"page",status:"published",version:0,revision:1,publishedRevision:1,remoteId:410,remoteOrigin:"https://example.com",remoteModified:"before",liveUrl:"https://example.com/about"});
 const draft:any=await SeoSchemaDraft.create({orgId:org,websiteId:site,name:"About schema",url:"https://example.com/about",jsonLd:{"@context":"https://schema.org","@type":"WebPage",name:"About",url:"https://example.com/about"},status:"draft",updatedBy:(await User.findOne({email:"owner@example.com"}))!._id});
 assert.equal((await call("/seo/schema/"+draft._id+"/publish","POST",{version:draft.version,contentId:String(content._id),contentVersion:content.version,reason:"Test request"})).status,409);
 const approved=await SeoSchemaDraft.findByIdAndUpdate(draft._id,{$set:{status:"approved",approvedBy:(await User.findOne({email:"seo@example.com"}))!._id},$inc:{version:1}},{new:true});
 const queued=await call("/seo/schema/"+draft._id+"/publish","POST",{version:approved!.version,contentId:String(content._id),contentVersion:content.version,reason:"Reviewed and approved"});
 assert.equal(queued.status,201,JSON.stringify(queued.data));assert.equal(queued.data.schema.status,"publishing");assert.equal(queued.data.job.operation,"schema");
 const latest=await SeoSchemaDraft.findById(draft._id);assert.equal(latest!.version,approved!.version+1);
 let remote:any={id:410,status:"publish",modified_gmt:"before",link:"https://example.com/about",meta:{aigrowthos_jsonld:null}},writes=0;
 setTestWpTransport(async(_c,path,method,body)=>{
  if(method==="POST"){writes++;remote={...remote,meta:body.meta,modified_gmt:"after"};return remote;}
  return remote;
 });
 await processPublication(queued.data.job._id);
 assert.equal((await PublishJob.findById(queued.data.job._id))!.status,"completed");assert.equal(writes,1);
 assert.equal((await SeoSchemaDraft.findById(draft._id))!.status,"approved");
 assert.equal((await ContentItem.findById(content._id))!.remoteModified,"after");
 setTestWpTransport();
});
test("uncertain schema publication is reconciled with a read-only check and never retried",async()=>{
 const content:any=await ContentItem.create({orgId:org,websiteId:site,title:"Services",slug:"services",type:"page",status:"published",version:0,revision:1,publishedRevision:1,remoteId:411,remoteOrigin:"https://example.com",remoteModified:"before",liveUrl:"https://example.com/services"});
 const owner=await User.findOne({email:"owner@example.com"});
 const jsonLd={"@context":"https://schema.org","@type":"WebPage",name:"Services",url:"https://example.com/services"};
 const schema:any=await SeoSchemaDraft.create({orgId:org,websiteId:site,name:"Services schema",url:jsonLd.url,jsonLd,status:"approved",approvedBy:owner!._id,updatedBy:owner!._id});
 const queued=await call("/seo/schema/"+schema._id+"/publish","POST",{version:schema.version,contentId:String(content._id),contentVersion:content.version,reason:"Approved page metadata"});
 assert.equal(queued.status,201,JSON.stringify(queued.data));
 let remote:any={id:411,status:"publish",modified_gmt:"before",link:"https://example.com/services",meta:{aigrowthos_jsonld:null}},writes=0;
 setTestWpTransport(async(_c,_path,method,body)=>{
  if(method==="POST"){writes++;remote={...remote,meta:body.meta,modified_gmt:"after"};throw Error("CMS_OUTCOME_UNKNOWN");}
  return remote;
 });
 await processPublication(queued.data.job._id);
 assert.equal((await PublishJob.findById(queued.data.job._id))!.status,"needs_review");assert.equal(writes,1);
 const check=await call("/cms/jobs/"+queued.data.job._id+"/reconcile","POST",{});
 assert.equal(check.status,201,JSON.stringify(check.data));assert.equal(check.data.applied,true);assert.equal(writes,1);
 assert.equal((await PublishJob.findById(queued.data.job._id))!.status,"completed");
 assert.equal((await SeoSchemaDraft.findById(schema._id))!.status,"approved");
 setTestWpTransport();
});
