import { chromium } from "playwright";
import { Fetcher, FetchResult } from "./safe-fetch";
export async function renderPage(result: FetchResult, domain: string, fetcher: Fetcher, allowed: (url: string) => boolean) {
  // Chromium has no direct outbound route: every supported request is fulfilled by
  // the vetted Node fetcher. A dead proxy is a second boundary for unhandled traffic.
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, proxy: { server: "http://127.0.0.1:9" }, args: ["--proxy-bypass-list=<-loopback>", "--disable-background-networking", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
  try {
    const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
    await context.routeWebSocket("**/*", socket => socket.close());
    let count = 0, bytes = 0;
    await context.route("**/*", async route => {
      try {
        const request = route.request();
        if (++count > 40 || request.method() !== "GET" || !["document","script","stylesheet","xhr","fetch"].includes(request.resourceType())) return await route.abort();
        const response = request.url() === result.finalUrl ? result : await fetcher(request.url(), domain, allowed);
        bytes += response.bytes; if (bytes > 10 * 1024 * 1024) return await route.abort();
        await route.fulfill({ status: response.statusCode, contentType: response.headers["content-type"] || "text/plain", body: response.body });
      } catch { await route.abort().catch(() => {}); }
    });
    const page = await context.newPage();
    await page.goto(result.finalUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1000);
    const body = await page.content();
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw Error("RENDER_TOO_LARGE");
    return { ...result, body };
  } finally { await browser.close(); }
}
