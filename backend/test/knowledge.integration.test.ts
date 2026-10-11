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
  await Session.create({userId:u._id,tokenHash:digest(name!),expiresAt:new Date(Date.now()+60000)});
  if(role)await Membership.create({orgId:org,userId:u._id,role});
 }
 site=String((await Website.create({orgId:org,name:"Test site",domain:"example.com",cmsType:"Other",verificationToken:"test"}))._id);
 otherSite=String((await Website.create({orgId:org,name:"Second site",domain:"second.example.com",cmsType:"Other",verificationToken:"test"}))._id);
 app=await createApp();await app.listen(0,"127.0.0.1");base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1/organizations/${org}/websites/`;
});
after(async()=>{await app?.close();await mongoose.disconnect();await db?.stop();});
async function call(suffix:string,method="GET",body?:any,actor="owner",website=site){
 const r=await fetch(base+website+"/knowledge"+suffix,{method,headers:{Origin:"http://localhost:3000","X-Growth-Client":"web","Content-Type":"application/json",Cookie:"growth_session="+actor},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
}
test("brand CRUD persists, fences roles and websites, audits changes, and supplies approved memory",async()=>{
 const body={title:"Evidence-backed claim",status:"draft",data:{claim:"Measured result",evidence:"Trial report"},references:[]};
 assert.equal((await call("/records/claims","POST",body,"viewer")).status,403);
 assert.equal((await call("/records/claims","POST",{...body,orgId:org})).status,422);
 const made=await call("/records/claims","POST",body);assert.equal(made.status,201,JSON.stringify(made.data));claim=made.data;
 assert.equal(await KnowledgeRecord.countDocuments({_id:claim._id,orgId:org,websiteId:site}),1);
 assert.equal((await call("/"+claim._id,"GET",undefined,"owner",otherSite)).status,404);
 assert.equal((await call("/"+claim._id,"GET",undefined,"outsider")).status,404);
 assert.equal((await call("/memory")).data.items.length,0);
 assert.equal((await call("/"+claim._id,"PATCH",{...body,status:"approved",version:0},"writer")).status,403);
 assert.equal((await call("/"+claim._id,"PATCH",{...body,status:"approved",version:0})).status,200);
 assert.equal((await call("/"+claim._id,"PATCH",{...body,version:0})).status,409);
 assert.equal((await call("/memory")).data.items[0]._id,claim._id);
 assert.equal(await Audit.countDocuments({orgId:org,entityId:claim._id}),2);
 const expired=await call("/records/proof","POST",{title:"Expired proof",status:"approved",data:{reviewDate:"2020-01-01"}});assert.equal(expired.status,201);
 assert.equal((await call("/memory")).data.items.length,1);
});
test("research and strategy retain scoped evidence and prevent cross-site references",async()=>{
 const project=await call("/records/projects","POST",{title:"Market study",data:{market:"India"}});assert.equal(project.status,201);
 const finding=await call("/records/findings","POST",{title:"Evidence review",data:{finding:"Review result"},references:[claim._id,project.data._id]});assert.equal(finding.status,201);
 assert.equal((await call("/records/findings","POST",{title:"Wrong website",references:[claim._id]},"owner",otherSite)).status,422);
 const task=await call("/records/tasks","POST",{title:"Review results",data:{dueDate:"2027-01-01"},references:[finding.data._id]});assert.equal(task.status,201);
 const context=await call("/context");assert.equal(context.status,200);assert.equal(context.data.memory.items.length,1);
 const list=await call("?kind=tasks&search=Review");assert.equal(list.data.items.length,1);
 assert.equal((await call("?kind=tasks&orgId=override")).status,422);
 assert.equal((await call("/records/business","POST",{title:"Business"})).status,201);
 assert.equal((await call("/records/business","POST",{title:"Duplicate"})).status,409);
});
test("private media bytes persist and downloads are fenced by website and membership",async()=>{
 const file=await call("/upload","POST",{name:"proof.pdf",type:"application/pdf",base64:Buffer.from("%PDF-1.7 test").toString("base64")});assert.equal(file.status,201,JSON.stringify(file.data));
 assert.equal((await call("/"+file.data._id+"/download","GET",undefined,"owner",otherSite)).status,404);
 const downloaded=await fetch(base+site+"/knowledge/"+file.data._id+"/download",{headers:{Cookie:"growth_session=viewer"}});
 assert.equal(downloaded.status,200);assert.match(downloaded.headers.get("content-disposition")!,/attachment/);assert.equal(await downloaded.text(),"%PDF-1.7 test");
});
import {WebsiteUrl} from "../src/crawler/models";
test("crawler source imports retain provenance, are idempotent, and stay out of approved memory",async()=>{
 const page:any=await WebsiteUrl.create({orgId:org,websiteId:site,jobId:new mongoose.Types.ObjectId(),url:"https://example.com/about",status:"crawled",data:{title:"About the business",description:"Actual crawl metadata"}});
 const first=await call("/import-page","POST",{pageId:String(page._id)});assert.equal(first.status,201);assert.equal(first.data.status,"draft");assert.match(first.data.source,/^crawl:/);
 assert.equal((await call("/import-page","POST",{pageId:String(page._id)})).data._id,first.data._id);
 assert.equal((await call("/import-page","POST",{pageId:String(page._id)},"owner",otherSite)).status,404);
 const options=await call("/options?current="+first.data._id);assert.ok(options.data.users.some((u:any)=>u.name==="owner"));assert.ok(options.data.records.some((r:any)=>r._id===first.data._id));
 assert.equal((await call("/memory")).data.items.some((r:any)=>r._id===first.data._id),false);
 const agenda=await call("/calendar?from=2026-12-01&to=2027-01-02");assert.equal(agenda.data.items.length,1);
});
