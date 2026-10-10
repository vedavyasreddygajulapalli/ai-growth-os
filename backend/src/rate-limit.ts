import Redis from "ioredis";
import { ServiceUnavailableException } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
// One atomic script for every API instance; Redis time prevents host clock skew.
export const rateLimitScript = `
local nowParts = redis.call('TIME')
local now = nowParts[1] * 1000 + math.floor(nowParts[2] / 1000)
local expires = tonumber(redis.call('HGET', KEYS[1], 'expires') or '0')
local blocked = tonumber(redis.call('HGET', KEYS[1], 'blocked') or '0')
local hits = tonumber(redis.call('HGET', KEYS[1], 'hits') or '0')
if blocked > now then return {hits, math.max(0, expires-now), 1, blocked-now} end
if expires <= now or blocked > 0 then hits = 0; expires = now + tonumber(ARGV[1]); blocked = 0 end
hits = hits + 1
if hits > tonumber(ARGV[2]) then blocked = now + tonumber(ARGV[3]) end
redis.call('HSET', KEYS[1], 'hits', hits, 'expires', expires, 'blocked', blocked)
redis.call('PEXPIRE', KEYS[1], math.max(expires, blocked)-now)
return {hits, expires-now, blocked > now and 1 or 0, math.max(0, blocked-now)}
`;
export class RedisRateLimitStore implements ThrottlerStorage {
  readonly client: Redis;
  constructor(url: string) {
    this.client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 3000, enableOfflineQueue: false });
    this.client.on("error", () => {}); // Errors are reported without connection credentials below.
  }
  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string) {
    try {
      if (this.client.status === "wait") await this.client.connect();
      const [totalHits, expires, blocked, blockExpires] = await this.client.eval(rateLimitScript, 1, `growth:limit:${name}:${key}`, ttl, limit, blockDuration || ttl) as number[];
      return { totalHits, timeToExpire: Math.ceil(expires / 1000), isBlocked: !!blocked, timeToBlockExpire: Math.ceil(blockExpires / 1000) };
    } catch {
      throw new ServiceUnavailableException({ code: "RATE_LIMIT_UNAVAILABLE", message: "Service temporarily unavailable. Try again shortly." });
    }
  }
  async ready() { if (this.client.status === "wait") await this.client.connect(); return await this.client.ping() === "PONG"; }
  close() { this.client.disconnect(); }
}
let sharedStore: RedisRateLimitStore | undefined;
export function rateLimitStore() {
  if (process.env.RATE_LIMIT_STORE !== "redis") return undefined;
  return sharedStore ||= new RedisRateLimitStore(process.env.REDIS_URL!);
}
export function closeRateLimitStore() { sharedStore?.close(); sharedStore = undefined; }
