import { CrawlJob } from "./models";

// Longer than one bounded fetch/render/persistence operation. The execution
// fence makes a late worker unable to publish after this transition wins.
export const STALE_CRAWL_MS = 10 * 60 * 1000;
export async function expireStaleCrawls(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_CRAWL_MS);
  return CrawlJob.updateMany({
    active: true,
    status: "running",
    $or: [{ heartbeatAt: { $lt: cutoff } }, { heartbeatAt: { $exists: false }, startedAt: { $lt: cutoff } }],
  }, {
    $set: { active: false, status: "failed", error: "WORKER_HEARTBEAT_EXPIRED", completedAt: now },
    $inc: { version: 1 },
  });
}
