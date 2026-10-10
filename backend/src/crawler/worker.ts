import { crawlSettings } from "./settings";
import { Worker } from "bullmq";
import Redis from "ioredis";
import mongoose from "mongoose";
import { connectDatabase } from "../database";
import { runCrawl } from "./engine";
import { CrawlJob } from "./models";
import { crawlQueue, queueName, redisConnection, closeCrawlQueue } from "./queue";
import { safeFetch } from "./safe-fetch";
import { expireStaleCrawls } from "./recovery";
async function main() {
  if (!process.env.MONGODB_URI || !process.env.REDIS_URL) throw Error("Worker database and queue settings required");
  await connectDatabase(process.env.MONGODB_URI);
  const settings = crawlSettings();
  await crawlQueue().setGlobalConcurrency(settings.concurrency);
  const redis = new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1,commandTimeout:5000}); redis.on("error",()=>{});
  const fetcher:typeof safeFetch = async (url,domain,allowed,_pace,interval=1000) => {
    // Global per-host pacing, including redirects and browser subresources.
    const pace = async () => {
      const delay=await redis.eval("local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000); local next=math.max(now,tonumber(redis.call('GET',KEYS[1]) or '0')); redis.call('SET',KEYS[1],next+tonumber(ARGV[1]),'PX',120000); return next-now",1,`growth:crawl:host:${domain}`,interval) as number;
      if(delay>30000)throw Error("HOST_BUSY");await new Promise(r=>setTimeout(r,delay));
    };
    let error:unknown;
    for(let attempt=0;attempt<2;attempt++)try{return await safeFetch(url,domain,allowed,pace);}catch(e){error=e;if(e instanceof Error && !["FETCH_FAILED","DNS_TIMEOUT"].includes(e.message))throw e;}
    throw error;
  };
  const worker=new Worker(queueName,async job=>runCrawl(String(job.data.id),fetcher),{connection:redisConnection(),concurrency:settings.concurrency,maxStalledCount:1});
  worker.on("error",()=>{process.send?.({type:"crawler.unavailable"});console.error("Crawl queue connection error");});
  worker.on("ready",()=>process.send?.({type:"crawler.ready"}));
  worker.on("failed",async job=>{if(job)await CrawlJob.updateOne({_id:job.data.id,active:true},{$set:{status:"failed",active:false,error:"WORKER_FAILED",completedAt:new Date()},$inc:{version:1}}).catch(()=>{});});
  let dispatching=false;
  const dispatch=async()=>{if(dispatching)return;dispatching=true;try{await expireStaleCrawls();const jobs=await CrawlJob.find({status:"queued",active:true}).limit(100).lean();for(const job of jobs)await crawlQueue().add("crawl",{id:String(job._id)},{jobId:String(job._id)});}catch{console.error("Crawl dispatch unavailable");}finally{dispatching=false;}};
  const timer=setInterval(dispatch,5000);await dispatch();
  let stopping=false; const stop=async()=>{if(stopping)return;stopping=true;clearInterval(timer);await worker.close();await closeCrawlQueue();redis.disconnect();await mongoose.disconnect();if(process.connected)process.disconnect();};
  process.on("SIGTERM",()=>void stop());process.on("SIGINT",()=>void stop());
  await worker.waitUntilReady();
  process.send?.({type:"crawler.ready"});
}
main().catch(()=>{console.error("Crawler startup failed; check configuration.");if(process.connected)process.disconnect();process.exitCode=1;});
