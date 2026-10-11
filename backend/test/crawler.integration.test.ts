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
import { expireStaleCrawls, STALE_CRAWL_MS } from "../src/crawler/recovery";
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
test("stale worker recovery releases the active slot and fences late publication",async()=>{
  const now=new Date();
  const stale=await CrawlJob.create({orgId:org,websiteId:site,status:"running",active:true,executionId:"lost-worker",heartbeatAt:new Date(now.getTime()-STALE_CRAWL_MS-1)});
  const beforeCount=await WebsiteUrl.countDocuments();
  assert.equal((await expireStaleCrawls(now)).modifiedCount,1);
  const recovered=await CrawlJob.findById(stale._id).lean<{status:string;error:string}>();
  assert.equal(recovered?.status,"failed");assert.equal(recovered?.error,"WORKER_HEARTBEAT_EXPIRED");
  assert.equal((await CrawlJob.updateOne({_id:stale._id,executionId:"lost-worker",status:"running"},{$set:{status:"completed"}})).matchedCount,0);
  await runCrawl(String(stale._id),fixture);assert.equal(await WebsiteUrl.countDocuments(),beforeCount);
  const fresh=await CrawlJob.create({orgId:org,websiteId:site,status:"running",active:true,heartbeatAt:now});
  assert.equal((await expireStaleCrawls(now)).modifiedCount,0);
  await CrawlJob.deleteOne({_id:fresh._id});
});
for (const action of ["cancel", "domain", "archive"] as const) {
  test(`in-flight ${action} prevents late page publication`, {timeout:20000}, async()=>{
    await Website.updateOne({_id:site},{$set:{status:"active",domain:"example.com",verificationStatus:"verified"}});
    const website:any=await Website.findById(site).lean();
    const started=await call(path()+"/crawls","POST",{version:website.version,mode:"single",startUrl:"https://example.com/"});
    assert.equal(started.status,201,JSON.stringify(started.data));
    const snapshot=JSON.stringify(await WebsiteUrl.find().sort({_id:1}).lean());
    let release!:()=>void, reached!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const fetching=new Promise<void>(resolve=>{reached=resolve;});
    const controlled:Fetcher=async(...args)=>{if(new URL(args[0]).pathname==="/"){reached();await held;}return fixture(...args);};
    const running=runCrawl(started.data._id,controlled);
    let deadline:ReturnType<typeof setTimeout>|undefined;
    try {
      await Promise.race([fetching,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error("worker did not reach page fetch")),10000);})]);
      if(action==="cancel") {
        const current=await call(path()+"/crawls/"+started.data._id);
        assert.equal((await call(path()+`/crawls/${started.data._id}/cancel`,"POST",{version:current.data.version})).status,200);
      } else {
        const changes=action==="domain"?{domain:"changed.example.com"}:{status:"archived"};
        assert.equal((await call(path(),"PATCH",{version:website.version,...changes})).status,200);
      }
    } finally {clearTimeout(deadline);release();await running;}
    const finished:any=await CrawlJob.findById(started.data._id).lean();
    assert.equal(finished.status,action==="cancel"?"cancelled":"failed");
    if(action!=="cancel")assert.equal(finished.error,"WEBSITE_CHANGED");
    assert.equal(await CrawlPage.countDocuments({jobId:started.data._id}),0);
    assert.equal(JSON.stringify(await WebsiteUrl.find().sort({_id:1}).lean()),snapshot);
  });
}

import { startEmbeddedCrawler, stopEmbeddedCrawler, embeddedCrawlerReady } from "../src/crawler/embedded";
test("embedded mode enforces API budgets and starts and stops the real child worker",{timeout:30000},async()=>{
  const previous={execution:process.env.CRAWLER_EXECUTION,mongo:process.env.MONGODB_URI};
  process.env.CRAWLER_EXECUTION="embedded";process.env.MONGODB_URI=db.getUri();
  await worker.close();
  await Website.updateOne({_id:site},{$set:{status:"active",domain:"example.com",verificationStatus:"verified"}});
  const website:any=await Website.findById(site).lean();
  try {
    assert.equal((await call(path()+"/crawls","POST",{version:website.version,maxPages:21})).status,422);
    assert.equal((await call(path()+"/crawls","POST",{version:website.version,renderJs:true})).status,422);
    const summary=await call(path()+"/crawl-summary");assert.equal(summary.data.limits.maxPages,20);
    const submitted=await call(path()+"/crawls","POST",{version:website.version});assert.equal(submitted.status,201);assert.equal(submitted.data.config.maxPages,20);
    await call(path()+`/crawls/${submitted.data._id}/cancel`,"POST",{version:submitted.data.version});
    startEmbeddedCrawler();
    for(let i=0;i<100 && !embeddedCrawlerReady();i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(embeddedCrawlerReady(),true);
    assert.equal(await crawlQueue().getGlobalConcurrency(),1);
    const health=await call("/health/ready");assert.equal(health.data.crawler.ready,true);
    // Isolated fixture: the real child must dispatch and refuse a private target.
    // Production website DTOs do not allow creating this target.
    const unsafeSite=await Website.create({orgId:org,name:"Unsafe fixture",verificationToken:"test-only",domain:"127.0.0.1",cmsType:"Other",status:"active",verificationStatus:"verified"});
    const unsafe=await CrawlJob.create({orgId:org,websiteId:unsafeSite._id,domain:"127.0.0.1",status:"queued",active:true,source:"test",config:{mode:"single",maxPages:1,renderJs:false,startUrl:"http://127.0.0.1/"}});
    let rejected:any;
    for(let i=0;i<100;i++){rejected=await CrawlJob.findById(unsafe._id).lean();if(!rejected.active)break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(rejected.status,"failed");assert.equal(rejected.error,"ROBOTS_UNAVAILABLE");
    assert.equal(await WebsiteUrl.countDocuments({websiteId:unsafeSite._id}),0);
  } finally {
    await stopEmbeddedCrawler();assert.equal(embeddedCrawlerReady(),false);
    if(previous.execution===undefined)delete process.env.CRAWLER_EXECUTION;else process.env.CRAWLER_EXECUTION=previous.execution;
    if(previous.mongo===undefined)delete process.env.MONGODB_URI;else process.env.MONGODB_URI=previous.mongo;
  }
});
