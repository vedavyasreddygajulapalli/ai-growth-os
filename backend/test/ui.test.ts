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
      data = { _id: "b".repeat(24), name: "Real Owner", emailVerifiedAt: "2026-10-09T00:00:00Z" };
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
test("unverified accounts see a real verification gate and do not request tenant data", async () => {
  const calls: string[] = [];
  const dom = setup(true, async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ name: "Unverified", email: "test@example.com", emailVerifiedAt: null }) };
  });
  click(dom, "live"); await tick();
  assert.match(dom.window.document.querySelector(".page")!.textContent!, /Verify your email/);
  assert.equal(calls.some(url => url.endsWith("/organizations")), false);
  click(dom, "send-verification");
  assert.match(dom.window.document.querySelector("#live-form")!.textContent!, /test@example.com/);
  dom.window.close();
});
test("password recovery form uses real endpoint and hides account existence", async () => {
  const calls: any[] = [];
  const dom = setup(true, async (url: string, options: any) => {
    calls.push([url, options]);
    return url.endsWith("/auth/password-reset")
      ? { ok: true, status: 202, json: async () => ({ message: "If an eligible account exists, a reset link will be sent." }) }
      : { ok: false, status: 401, json: async () => ({ error: { message: "Sign in" } }) };
  });
  click(dom, "live"); await tick(); click(dom, "sign-in"); click(dom, "forgot-password");
  const form = dom.window.document.querySelector("#live-form") as HTMLFormElement;
  (form.querySelector("[name=email]") as HTMLInputElement).value = "test@example.com";
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  assert.ok(calls.some(([url, opts]) => url.endsWith("/auth/password-reset") && JSON.parse(opts.body).email === "test@example.com"));
  assert.match(dom.window.document.querySelector("#overlay")!.textContent!, /If an eligible account exists/);
  dom.window.close();
});

test("crawler UI reads real endpoints, renders empty/progress states and hides write actions for Viewer", async () => {
  for (const role of ["Owner", "Viewer"]) {
    const calls:string[]=[];
    const org={_id:"a".repeat(24),name:"Org",role,timezone:"UTC"};
    const site={_id:"c".repeat(24),name:"Verified Site",domain:"example.com",verificationStatus:"verified",status:"active",cmsType:"Other",version:0};
    const dom=setup(true,async (url:string)=>{
      calls.push(url);let data:any;
      if(url.endsWith("/auth/me"))data={name:"Member",emailVerifiedAt:"2026-10-10T00:00:00Z"};
      else if(url.endsWith("/organizations"))data={items:[org]};
      else if(url.endsWith("/websites"))data={items:[site]};
      else if(url.endsWith("/crawls"))data={items:[{_id:"d".repeat(24),status:"running",progress:25,discovered:4,crawled:1,version:0}]};
      else if(url.endsWith("/crawl-summary"))data={total:0,indexable:0,notIndexable:0,limits:{maxPages:20,defaultPages:20,renderJs:false}};
      else if(url.includes("/urls?"))data={items:[],total:0};
      else throw Error(url);
      return{ok:true,status:200,json:async()=>data};
    });
    click(dom,"live");await tick();click(dom,"tab:Websites");await tick();click(dom,"open-crawls:"+site._id);await tick();
    assert.match(dom.window.document.body.textContent!,/running|25%/);
    assert.equal(!!dom.window.document.querySelector('[data-live="start-crawl"]'),role==="Owner");
    if(role==="Owner") {
      click(dom,"start-crawl");
      assert.equal((dom.window.document.querySelector('[name="maxPages"]') as HTMLInputElement).value,"20");
      assert.equal(dom.window.document.querySelectorAll('[name="renderJs"] option').length,1);
      (dom.window.document.querySelector("[data-close]") as HTMLButtonElement).click();
    }
    click(dom,"tab:URL Inventory");await tick();assert.match(dom.window.document.body.textContent!,/No matching URLs/);
    click(dom,"url-filter");assert.ok(dom.window.document.querySelector('[name="statusCode"]'));
    assert.ok(calls.some(x=>x.endsWith("/crawls")));dom.window.close();
  }
});

test("Brand UI uses saved data, preserves ten modules, and restricts Viewer mutations",async()=>{
 const org={_id:"a".repeat(24),name:"Saved workspace",role:"Viewer"};
 const site={_id:"b".repeat(24),name:"Saved website",status:"active"};
 const fetcher=async(url:string)=>{
  let data:any;
  if(url.endsWith("/auth/me"))data={name:"Viewer",emailVerifiedAt:"2026-01-01"};
  else if(url.endsWith("/organizations"))data={items:[org]};
  else if(url.includes("/websites?"))data={items:[site]};
  else if(url.endsWith("/knowledge/catalog"))data={catalog:{business:{label:"Business profile",module:"brand",fields:[]}}};
  else if(url.includes("/knowledge?"))data={items:[{_id:"c".repeat(24),title:"Persisted business",kind:"business",status:"draft",data:{},updatedAt:"2026-01-01"}],nextCursor:null};
  else throw Error(url);
  return {ok:true,status:200,json:async()=>data};
 };
 const dom=setup(true,fetcher);click(dom,"live");await tick();
 runInContext('navigate("brand")',dom.getInternalVMContext());await tick();await tick();
 const text=dom.window.document.querySelector(".page")!.textContent!;
 assert.match(text,/Persisted business/);assert.doesNotMatch(text,/Acme Studio|86/);
 assert.equal(dom.window.document.querySelectorAll(".nav a").length,10);
 assert.equal(dom.window.document.querySelector('[data-live="knowledge-new"]'),null);
 assert.equal(dom.window.document.querySelector('[data-live^="knowledge-edit:"]'),null);
 dom.window.close();
});
test("Brand editor submits scoped data with named evidence choices and retains API validation errors",async()=>{
 const org={_id:"a".repeat(24),name:"Saved workspace",role:"Owner"},site={_id:"b".repeat(24),name:"Saved website",status:"active"};let payload:any;
 const fetcher=async(url:string,opts:any)=>{
  let data:any;
  if(url.endsWith("/auth/me"))data={name:"Owner",emailVerifiedAt:"2026-01-01"};
  else if(url.endsWith("/organizations"))data={items:[org]};
  else if(url.includes("/websites?"))data={items:[site]};
  else if(url.endsWith("/knowledge/catalog"))data={catalog:{business:{label:"Business profile",module:"brand",fields:[{key:"industry",label:"Industry",type:"text"}]}}};
  else if(url.endsWith("/knowledge/options"))data={records:[{_id:"c".repeat(24),title:"Approved evidence",kind:"business"}],users:[]};
  else if(url.endsWith("/knowledge/records/business")){payload=JSON.parse(opts.body);return {ok:false,status:422,json:async()=>({error:{message:"Check industry"}})};}
  else if(url.includes("/knowledge?"))data={items:[],nextCursor:null};else throw Error(url);
  return {ok:true,status:200,json:async()=>data};
 };
 const dom=setup(true,fetcher);click(dom,"live");await tick();runInContext('navigate("brand")',dom.getInternalVMContext());await tick();await tick();click(dom,"knowledge-new");await tick();
 const doc=dom.window.document;(doc.querySelector('[name="title"]') as HTMLInputElement).value="Saved business";
 (doc.querySelector('[name="industry"]') as HTMLInputElement).value="Technology";
 const ref=doc.querySelector('[name="references"] option') as HTMLOptionElement;assert.match(ref.textContent!,/Approved evidence/);ref.selected=true;
 doc.querySelector('form')!.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));await tick();
 assert.deepEqual(payload,{title:"Saved business",status:"draft",data:{industry:"Technology"},references:["c".repeat(24)]});
 assert.match(doc.querySelector('#live-error')!.textContent!,/Check industry/);assert.equal((doc.querySelector('[name="title"]') as HTMLInputElement).value,"Saved business");dom.window.close();
});
test('Content workspace loads persisted records and keeps Viewer publishing controls hidden',async()=>{
 const org={_id:'a'.repeat(24),name:'Saved workspace',role:'Viewer'},site={_id:'b'.repeat(24),name:'Saved website',status:'active'};
 const fetcher=async(url:string)=>{let data:any;if(url.endsWith('/auth/me'))data={name:'Viewer',emailVerifiedAt:'2026-01-01'};else if(url.endsWith('/organizations'))data={items:[org]};else if(url.includes('/websites?'))data={items:[site]};else if(url.includes('/content?'))data={items:[{_id:'c'.repeat(24),title:'Persisted article',slug:'persisted',type:'post',status:'review',updatedAt:'2026-10-11'}]};else if(url.endsWith('/cms'))data={connection:null};else if(url.endsWith('/jobs')||url.endsWith('/templates'))data={items:[]};else throw Error(url);return {ok:true,status:200,json:async()=>data};};
 const dom=setup(true,fetcher);click(dom,'live');await tick();runInContext('navigate("content")',dom.getInternalVMContext());await tick();await tick();
 assert.match(dom.window.document.body.textContent!,/Persisted article/);assert.equal(dom.window.document.querySelector('[data-live="content-new"]'),null);assert.equal(dom.window.document.querySelector('[data-live="content-wordpress"]'),null);dom.window.close();
});
test('Template composer uses existing UI and retains edits after validation failure',async()=>{
 const org={_id:'a'.repeat(24),name:'Workspace',role:'Owner'},site={_id:'b'.repeat(24),name:'Website',status:'active'};let sent:any;
 const fetcher=async(url:string,options:any)=>{let data:any;if(url.endsWith('/auth/me'))data={name:'Owner',emailVerifiedAt:'2026-01-01'};else if(url.endsWith('/organizations'))data={items:[org]};else if(url.includes('/websites?'))data={items:[site]};else if(url.endsWith('/templates')&&options?.method==='POST'){sent=JSON.parse(options.body);return {ok:false,status:422,json:async()=>({error:{message:'Check template blocks'}})};}else if(url.includes('/content?')||url.endsWith('/templates')||url.endsWith('/jobs')||url.includes('/knowledge?'))data={items:[]};else if(url.endsWith('/cms'))data={connection:null};else throw Error(url);return {ok:true,status:200,json:async()=>data};};
 const dom=setup(true,fetcher);click(dom,'live');await tick();runInContext('navigate("content")',dom.getInternalVMContext());await tick();await tick();click(dom,'content-templates');await tick();click(dom,'content-template-new');await tick();
 const doc=dom.window.document;(doc.querySelector('[name="name"]') as HTMLInputElement).value='Reusable draft';(doc.querySelector('[name="text0"]') as HTMLTextAreaElement).value='Safe block text';doc.querySelector('#template-editor')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
 assert.equal(sent.name,'Reusable draft');assert.equal(sent.mapping,'basic_html');assert.equal(sent.blocks[0].text,'Safe block text');assert.match(doc.querySelector('#template-error')!.textContent!,/Check template blocks/);assert.equal((doc.querySelector('[name="name"]') as HTMLInputElement).value,'Reusable draft');dom.window.close();
});

test("SEO workspace uses scoped crawl evidence and shows providers as disconnected without live metrics",async()=>{
 const org={_id:"a".repeat(24),name:"Saved workspace",role:"SEO Manager"},site={_id:"b".repeat(24),name:"Saved website",domain:"saved.example.com",status:"active"};
 const calls:any[]=[];
 const fetcher=async(url:string,opts:any={})=>{
  calls.push([url,opts]);let data:any;
  if(url.endsWith("/auth/me"))data={name:"SEO Manager",emailVerifiedAt:"2026-01-01"};
  else if(url.endsWith("/organizations"))data={items:[org]};
  else if(url.includes("/websites?")||url.endsWith("/websites"))data={items:[site],nextCursor:null};
  else if(url.endsWith("/seo/summary"))data={crawl:{id:"c".repeat(24),status:"completed",completedAt:"2026-10-11T00:00:00Z",truncated:false},auditedPages:33,indexable:24,notIndexable:4,unknown:5,issues:[],providers:{}};
  else if(url.endsWith("/seo/providers"))data={items:[{key:"search_console",label:"Google Search Console",data:"Search performance",connection:"OAuth authorization required",status:"disconnected",property:null,version:null,metricsAvailable:false},{key:"rankings",label:"Keyword rankings",data:"Ranking observations",connection:"Provider authorization required",status:"disconnected",property:null,version:null,metricsAvailable:false},{key:"ai_visibility",label:"AI visibility",data:"Citation observations",connection:"Provider authorization required",status:"disconnected",property:null,version:null,metricsAvailable:false}]};
  else if(url.endsWith("/seo/schema"))data={items:[{_id:"d".repeat(24),name:"Approved schema",url:"https://saved.example.com/",jsonLd:{"@type":"WebPage"},status:"approved"}]};
  else if(url.endsWith("/seo/publish-targets"))data={items:[],available:false,reason:"WordPress schema publication is not configured."};
  else if(url.endsWith("/cms/jobs"))data={items:[]};
  else if(url.endsWith("/seo/providers/search_console/connect")&&opts.method==="POST"){data={key:"search_console",status:"authorization_required",property:"sc-domain:saved.example.com",version:0,notice:"Authorization is not connected yet. No provider data is available until a verified provider authorization flow is configured."};}
  else throw Error("Unexpected request "+url);
  return {ok:true,status:200,json:async()=>data};
 };
 const dom=setup(true,fetcher);try{click(dom,"live");await tick();runInContext('navigate("seo")',dom.getInternalVMContext());await tick();await tick();
 let page=dom.window.document.querySelector(".page")!.textContent!;
 assert.match(page,/SEO & AI Visibility/);assert.match(page,/33/);assert.match(page,/24 \/ 4 \/ 5/);assert.doesNotMatch(page,/24,892|Sample metrics|Acme Studio/);
 click(dom,"seo-tab:Schema");assert.match(dom.window.document.querySelector(".page")!.textContent!,/Approved schema/);assert.equal(dom.window.document.querySelector('[data-live^="seo-schema-publish:"]'),null);click(dom,"seo-tab:Providers");assert.match(dom.window.document.querySelector(".page")!.textContent!,/Google Search Console/);
 assert.match(dom.window.document.querySelector(".page")!.textContent!,/No provider data is available/);
 click(dom,"seo-connect:search_console");
 const form=dom.window.document.querySelector("#live-form") as HTMLFormElement;
 (form.querySelector('[name="property"]') as HTMLInputElement).value="sc-domain:saved.example.com";
 form.dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true}));await tick();await tick();
 assert.ok(calls.some(([url,opts])=>url.endsWith("/seo/providers/search_console/connect")&&opts.method==="POST"));
 assert.match(dom.window.document.body.textContent!,/No provider data is available/);
 assert.equal(dom.window.localStorage.length,0);}finally{dom.window.close();}
});
