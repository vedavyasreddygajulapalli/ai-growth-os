import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInContext } from "node:vm";
import { JSDOM } from "jsdom";
const read = (f: string) =>
  readFileSync(resolve(process.cwd(), "../dist", f), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 30));
function setup(enabled: boolean, fetcher?: any) {
  const dom = new JSDOM(
    '<div id="app"></div><div id="overlay"></div><div id="toast"></div>',
    { url: "https://growth.example/#settings", runScripts: "outside-only" },
  );
  const w = dom.window as any;
  w.structuredClone = structuredClone;
  w.scrollTo = () => {};
  w.GROWTH_CONFIG = { apiEnabled: enabled };
  w.fetch = fetcher;
  runInContext(read("app.js"), dom.getInternalVMContext());
  runInContext(read("foundation.js"), dom.getInternalVMContext());
  return dom;
}
function click(dom: JSDOM, action: string) {
  const b = dom.window.document.querySelector(
    `[data-live="${action}"]`,
  ) as HTMLButtonElement;
  assert.ok(b, action);
  b.click();
}
test("all ten approved modules remain and disconnected service never presents fake live data", async () => {
  const dom = setup(false);
  assert.equal(dom.window.document.querySelectorAll(".nav a").length, 10);
  click(dom, "live");
  await tick();
  const page = dom.window.document.querySelector(".page")!.textContent!;
  assert.match(page, /awaiting connection/);
  assert.doesNotMatch(page, /24,892|Acme Studio|Create account/);
  click(dom, "demo");
  assert.match(dom.window.document.body.textContent!, /Design preview/);
  dom.window.close();
});
test("connected adapter loads org/site records from API and keeps live writes out of browser storage", async () => {
  const calls: any[] = [];
  const org = {
    _id: "a".repeat(24),
    name: "Persisted Company",
    timezone: "Asia/Kolkata",
    currency: "INR",
    role: "Owner",
    version: 0,
  };
  const fetcher = async (url: string, opts: any) => {
    calls.push([url, opts]);
    let data: any;
    if (url.endsWith("/auth/me"))
      data = { _id: "b".repeat(24), name: "Real Owner" };
    else if (url.endsWith("/organizations")) data = { items: [org] };
    else if (url.endsWith("/websites"))
      data = {
        items: [
          {
            _id: "c".repeat(24),
            name: "Real Site",
            domain: "real.example.com",
            cmsType: "WordPress",
            verificationStatus: "unverified",
            status: "active",
            version: 0,
          },
        ],
        nextCursor: null,
      };
    else throw Error("Unexpected request " + url);
    return { ok: true, status: 200, json: async () => data };
  };
  const dom = setup(true, fetcher);
  click(dom, "live");
  await tick();
  assert.match(
    dom.window.document.querySelector(".page")!.textContent!,
    /Persisted Company/,
  );
  click(dom, "tab:Websites");
  await tick();
  assert.match(
    dom.window.document.querySelector(".page")!.textContent!,
    /real.example.com/,
  );
  assert.equal(dom.window.localStorage.length, 0);
  assert.ok(calls.every(([, o]) => o.credentials === "same-origin"));
  click(dom, "add-site");
  const form = dom.window.document.querySelector("#live-form")!;
  assert.ok(form.querySelector("[name=domain]"));
  dom.window.close();
});
test("form errors preserve unsaved values and show API failure without success", async () => {
  let authenticated = false;
  const fetcher = async (url: string, opts: any) => {
    if (url.endsWith("/auth/register"))
      return {
        ok: false,
        status: 422,
        json: async () => ({
          error: {
            message: "Check the highlighted fields.",
            details: [{ field: "password", message: "Too weak" }],
          },
        }),
      };
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Sign in" } }),
    };
  };
  const dom = setup(true, fetcher);
  click(dom, "live");
  await tick();
  click(dom, "sign-up");
  const form = dom.window.document.querySelector(
    "#live-form",
  ) as HTMLFormElement;
  for (const [name, value] of Object.entries({
    name: "Test Person",
    email: "person@example.com",
    password: "Long Password 123!",
  }))
    (form.querySelector(`[name=${name}]`) as HTMLInputElement).value = value;
  form.dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
  assert.equal(
    (form.querySelector("[name=email]") as HTMLInputElement).value,
    "person@example.com",
  );
  assert.match(form.textContent!, /Too weak/);
  assert.equal(
    (form.querySelector("[type=submit]") as HTMLButtonElement).disabled,
    false,
  );
  dom.window.close();
});
