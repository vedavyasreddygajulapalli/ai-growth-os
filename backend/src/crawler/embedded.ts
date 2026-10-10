import { ChildProcess, fork } from "node:child_process";
import { join } from "node:path";
import { crawlSettings } from "./settings";

let child: ChildProcess | undefined;
let restart: ReturnType<typeof setTimeout> | undefined;
let stopping = false, ready = false, failures = 0;
export function embeddedCrawlerReady() { return ready; }
export function startEmbeddedCrawler() {
  if (process.env.CRAWLER_ENABLED !== "true" || crawlSettings().execution !== "embedded" || child) return;
  stopping = false;
  const launch = () => {
    if (stopping) return;
    // Parsing stays off the API event loop. Do not pass account/email secrets.
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "NODE_ENV", "MONGODB_URI", "REDIS_URL", "CRAWLER_ENABLED", "CRAWLER_EXECUTION", "CRAWLER_RENDER_JS", "NODE_EXTRA_CA_CERTS"])
      if (process.env[name] !== undefined) env[name] = process.env[name];
    child = fork(join(__dirname, "worker.js"), [], { env, execArgv: ["--max-old-space-size=128"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", message => {
      if (message && typeof message === "object" && "type" in message && message.type === "crawler.ready") { ready = true; failures = 0; }
      if (message && typeof message === "object" && "type" in message && message.type === "crawler.unavailable") ready = false;
    });
    child.on("error", () => { ready = false; console.error("Embedded crawler process unavailable"); });
    child.on("exit", () => {
      ready = false; child = undefined;
      if (!stopping) restart = setTimeout(launch, Math.min(60000, 5000 * 2 ** Math.min(failures++, 4)));
    });
  };
  launch();
}
export async function stopEmbeddedCrawler() {
  stopping = true; ready = false; clearTimeout(restart);
  const current = child;
  if (!current) return;
  await new Promise<void>(resolve => {
    const deadline = setTimeout(() => current.kill("SIGKILL"), 10000);
    current.once("exit", () => { clearTimeout(deadline); resolve(); });
    current.kill("SIGTERM");
  });
}
