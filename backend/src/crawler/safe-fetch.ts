import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
export const USER_AGENT = "AIGrowthOSBot/1.0";
export function publicAddress(address: string) {
  try { let ip = ipaddr.parse(address); if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address(); return ip.range() === "unicast"; } catch { return false; }
}
export function normalizeUrl(raw: string, base?: string) {
  const u = new URL(raw, base);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.port || u.hostname.endsWith(".") || u.href.length > 2048) throw Error("UNSAFE_URL");
  u.hash = ""; u.searchParams.sort();
  // Preserve path case, meaningful query parameters and trailing slash: servers may distinguish them.
  return u.href;
}
export function sameHost(url: string, domain: string) { try { return new URL(url).hostname === domain; } catch { return false; } }
export interface FetchResult { url: string; finalUrl: string; statusCode: number; headers: Record<string, string>; body: string; bytes: number; responseMs: number; redirects: { url: string; status: number; location: string }[] }
export type Fetcher = (url: string, domain: string, allowed?: (url: string) => boolean, pace?: () => Promise<void>, interval?: number) => Promise<FetchResult>;
export const safeFetch: Fetcher = async (raw, domain, allowed = () => true, pace = async () => {}) => {
  const started = Date.now(), original = normalizeUrl(raw), redirects: FetchResult["redirects"] = [], seen = new Set<string>();
  let url = original;
  for (let hop = 0; hop <= 5; hop++) {
    if (!sameHost(url, domain) || !allowed(url)) throw Error("OUT_OF_SCOPE_OR_ROBOTS");
    if (seen.has(url)) throw Error("REDIRECT_LOOP"); seen.add(url);
    await pace();
    const u = new URL(url);
    const addresses = await Promise.race([lookup(u.hostname, { all: true, verbatim: true }), new Promise<never>((_, reject) => { const t = setTimeout(() => reject(Error("DNS_TIMEOUT")), 5000); t.unref(); })]);
    if (!addresses.length || addresses.some(x => !publicAddress(x.address))) throw Error("UNSAFE_ADDRESS");
    const pinned = addresses[0];
    const response = await new Promise<{ statusCode: number; headers: Record<string, string>; body: string; bytes: number }>((resolve, reject) => {
      const req = (u.protocol === "https:" ? https : http).request(u, {
        method: "GET", agent: false, headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*;q=0.1", "Accept-Encoding": "identity" },
        // Bind the socket to the vetted address; no second DNS lookup (rebinding).
        lookup: ((_host: any, _opts: any, cb: any) => cb(null, pinned.address, pinned.family)) as any,
      }, res => {
        const headers: Record<string, string> = {};
        for (const name of ["content-type", "location", "x-robots-tag", "content-language", "last-modified"]) if (res.headers[name]) headers[name] = String(res.headers[name]).slice(0, 4096);
        if (Number(res.headers["content-length"] || 0) > 2 * 1024 * 1024) { res.destroy(); reject(Error("RESPONSE_TOO_LARGE")); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        res.on("data", chunk => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) { res.destroy(); reject(Error("RESPONSE_TOO_LARGE")); } else chunks.push(chunk); });
        res.on("end", () => resolve({ statusCode: res.statusCode || 0, headers, body: Buffer.concat(chunks).toString("utf8"), bytes }));
        res.on("error", () => reject(Error("FETCH_FAILED")));
      });
      const timer = setTimeout(() => req.destroy(Error("FETCH_TIMEOUT")), 10000);
      req.on("close", () => clearTimeout(timer)); req.on("error", () => reject(Error("FETCH_FAILED"))); req.end();
    });
    if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
      if (hop === 5) throw Error("TOO_MANY_REDIRECTS");
      const next = normalizeUrl(response.headers.location, url);
      redirects.push({ url, status: response.statusCode, location: next }); url = next; continue;
    }
    return { url: original, finalUrl: url, ...response, responseMs: Date.now() - started, redirects };
  }
  throw Error("TOO_MANY_REDIRECTS");
};
