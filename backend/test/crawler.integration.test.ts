import { before,after,test } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { Worker } from "bullmq";
import { createApp } from "../src/app";
import { connectDatabase,Website } from "../src/database";
import { runMigrations } from "../src/migrations";
import { setTestEmailTransport } from "../src/email";
import { runCrawl } from "../src/crawler/engine";
import { CrawlJob,CrawlPage,WebsiteUrl,TechnicalIssue,RobotsRecord,SitemapRecord } from "../src/crawler/models";
import { crawlQueue,closeCrawlQueue,redisConnection,queueName } from "../src/crawler/queue";
import { Fetcher } from "../src/crawler/safe-fetch";
let db:MongoMemoryReplSet,app:any,base:string,cookie:string,org:string,site:string,job:any,worker:Worker;
process.env.NODE_ENV="test";process.env.APP_ORIGINS="http://localhost:3000";process.env.CRAWLER_ENABLED="true";process.env.REDIS_URL=process.env.REDIS_TEST_URL||"redis://127.0.0.1:6379";
let token="";setTestEmailTransport(async m=>{token=m.text.match(/verify=([a-f0-9]+)/)![1];});
async function call(path:string,method="GET",body?:any,c=cookie){const r=await fetch(base+path,{method,headers:{Origin:"http://localhost:3000","X-Growth-Client":"web","Content-Type":"application/json",Cookie:c||""},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]||""};}
const path=()=>`/organizations/${org}/websites/${site}`;
const fetched:string[]=[];
const fixture:Fetcher=async(url,domain,allowed)=>{
  fetched.push(url);if(allowed && !allowed(url))throw Error("OUT_OF_SCOPE_OR_ROBOTS");
  const route=new URL(url).pathname;
  let body="",type="text/html",statusCode=200;
  if(route==="/robots.txt"){body="User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml";type="text/plain";}
  else if(route==="/sitemap.xml"){body='<sitemapindex><sitemap><loc>https://example.com/nested.xml</loc></sitemap></sitemapindex>';type="application/xml";}
  else if(route==="/nested.xml"){body='<urlset><url><loc>https://example.com/orphan</loc></url><url><loc>https://example.com/a</loc></url></urlset>';type="application/xml";}
  else if(route==="/missing")statusCode=404;
  else body=`<html><title>Shared page title for tests</title><meta name="description" content="Shared description"><h1>Page</h1><p>Identical useful content</p>${route==="/"?'<a href="/a">A</a><a href="/a#top">A again</a><a href="/missing">Broken</a><a href="/private">Private</a>':""}</html>`;
  return{url,finalUrl:url,statusCode,headers:{"content-type":type},body,bytes:body.length,responseMs:1,redirects:[]};
};
before(async()=>{db=await MongoMemoryReplSet.create({replSet:{count:1},binary:{version:"7.0.24"}});await connectDatabase(db.getUri());await runMigrations();app=await createApp();await app.listen(0,"127.0.0.1");base=await app.getUrl()+"/api/v1";
  const user=await call("/auth/register","POST",{name:"Crawler Owner",email:"crawler@example.com",password:"Strong Passphrase 123!"});cookie=user.cookie;
  await call("/auth/email-verification","POST",{});await call("/auth/email-verification/complete","POST",{token});
  org=(await call("/organizations","POST",{name:"Crawler Org",timezone:"UTC",currency:"USD"})).data._id;
  site=(await call(`/organizations/${org}/websites`,"POST",{name:"Fixture Website",domain:"example.com",cmsType:"Other"})).data._id;
});
after(async()=>{await worker?.close();await closeCrawlQueue();await app?.close();await mongoose.disconnect();await db?.stop();});
test("unverified sites cannot crawl and DTOs reject tenant overrides",async()=>{
  assert.equal((await call(path()+"/crawls","POST",{version:0})).status,409);
  assert.equal((await call(path()+"/crawls","POST",{version:0,orgId:org})).status,422);
  // Ownership is a fixture precondition in the isolated database, never a production bypass.
  await Website.updateOne({_id:site},{$set:{verificationStatus:"verified",verifiedAt:new Date()}});
});
test("queue worker discovers nested sitemap, persists inventory and real technical evidence",async()=>{
  const started=await call(path()+"/crawls","POST",{version:0,maxPages:20});assert.equal(started.status,201,JSON.stringify(started.data));job=started.data;
  assert.equal((await call(path()+"/crawls","POST",{version:0})).status,409);
  worker=new Worker(queueName,async j=>runCrawl(j.data.id,fixture),{connection:redisConnection(),concurrency:1});
  await crawlQueue().add("crawl",{id:job._id},{jobId:job._id});
  for(let i=0;i<200;i++){job=await CrawlJob.findById(job._id).lean();if(!job.active)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(job.status,"completed_with_errors",JSON.stringify(job));assert.equal(job.progress,100);
  assert.equal(fetched.includes("https://example.com/private"),false);
  assert.equal(await CrawlPage.countDocuments({jobId:job._id,url:"https://example.com/a"}),1);
  assert.ok(await TechnicalIssue.findOne({jobId:job._id,type:"broken_internal_link"}));assert.ok(await TechnicalIssue.findOne({jobId:job._id,type:"orphan_candidate"}));
  assert.equal(await RobotsRecord.countDocuments({jobId:job._id}),1);assert.equal(await SitemapRecord.countDocuments({jobId:job._id}),2);
  assert.ok(await WebsiteUrl.countDocuments({orgId:org,websiteId:site}));
  const inventory=await call(path()+"/urls?statusCode=404");assert.equal(inventory.data.total,1);const detail=await call(path()+"/urls/"+inventory.data.items[0]._id);assert.ok(detail.data.history.length);
});
test("cancel and retry preserve snapshots; cross-tenant access is denied",async()=>{
  const retry=await call(path()+`/crawls/${job._id}/retry`,"POST",{version:job.version});assert.equal(retry.status,201,JSON.stringify(retry.data));
  const cancelled=await call(path()+`/crawls/${retry.data._id}/cancel`,"POST",{version:retry.data.version});assert.equal(cancelled.status,200);
  const count=await WebsiteUrl.countDocuments();await runCrawl(retry.data._id,fixture);assert.equal(await WebsiteUrl.countDocuments(),count);
  const foreign=await call("/auth/register","POST",{name:"Other Owner",email:"foreign@example.com",password:"Strong Passphrase 123!"});await call("/auth/email-verification","POST",{},foreign.cookie);await call("/auth/email-verification/complete","POST",{token},foreign.cookie);
  for(const endpoint of ["/crawls","/urls","/crawl-summary",`/crawls/${job._id}/issues`])assert.equal((await call(path()+endpoint,"GET",undefined,foreign.cookie)).status,404);
});
