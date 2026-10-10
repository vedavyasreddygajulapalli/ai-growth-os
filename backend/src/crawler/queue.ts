import { Queue } from "bullmq";
export const queueName = "growth-crawls";
export function redisConnection() {
  if (!process.env.REDIS_URL) throw Error("REDIS_URL required for crawler");
  const u = new URL(process.env.REDIS_URL);
  return { host: u.hostname, port: Number(u.port || 6379), username: u.username ? decodeURIComponent(u.username) : undefined, password: u.password ? decodeURIComponent(u.password) : undefined, db: Number(u.pathname.slice(1) || 0), ...(u.protocol === "rediss:" ? { tls: {} } : {}), maxRetriesPerRequest: null };
}
let queue: Queue | undefined;
export function crawlQueue() { return queue ||= new Queue(queueName, { connection: redisConnection(), defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 86400, count: 100 }, removeOnFail: { age: 604800, count: 100 } } }); }
export async function closeCrawlQueue() { await queue?.close(); queue = undefined; }
