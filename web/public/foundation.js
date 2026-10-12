/* Foundation adapter. The approved prototype remains intact; real tenant state
   is held only in memory and persisted exclusively by the authenticated API. */
(() => {
  const cfg = window.GROWTH_CONFIG || { apiEnabled: false };
  const live = {
    active: false,
    loading: false,
    user: null,
    orgs: [],
    org: null,
    tab: "Organization",
    sites: [],
    members: [],
    invites: [],
    audit: [],
    auditFilters: {},
    crawlSite: null, crawls: [], crawlSummary: null, crawlFocus: null,
    crawlReport: null, urlItems: [], urlTotal: 0, urlPage: 1, urlFilters: {},
    seoSite: null, seoSummary: null, seoProviders: [], seoDrafts: [], seoTargets: [], seoTargetStatus: null, seoJobs: [], seoTab: "Overview", seoLoading: false, seoLoaded: false,
    crmSite:null, crmLeads:[], crmSummary:null, crmForms:[], crmMembers:[], crmFocus:null, crmProfile:null, crmTab:"Inbox", crmLoaded:false, crmLoading:false,
    sessions: [],
    securityEvents: [],
    error: "",
    cursor: null,
    generation: 0,
  };
  const originalRender = render,
    originalSettings = settings,
    originalAction = action;
  const roleNames = [
    "Admin",
    "Marketing Manager",
    "SEO Manager",
    "Content Writer",
    "Sales User",
    "Viewer",
  ];
  function clearCrawlState() { live.crawlSite=null; live.crawls=[]; live.crawlFocus=null; live.crawlSummary=null; live.crawlReport=null; live.urlItems=[]; live.urlFilters={}; live.urlPage=1; live.urlTotal=0; live.seoSite=null; live.seoSummary=null; live.seoProviders=[]; live.seoDrafts=[]; live.seoLoaded=false; live.seoLoading=false; }
  const canCrawl = () => ["Owner", "Admin", "Marketing Manager", "SEO Manager"].includes(live.org?.role);
  const isManager = () => ["Owner", "Admin"].includes(live.org?.role);
  const button = (label, act, primary = false) =>
    `<button type="button" class="btn ${primary ? "primary" : ""}" data-live="${act}">${esc(label)}</button>`;
  const input = (label, name, value = "", type = "text", required = true) =>
    `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" type="${type}" ${required ? "required" : ""} ${type === "password" && name !== "currentPassword" ? 'minlength="12" maxlength="128" autocomplete="current-password"' : ""}></label>`;
  const select = (label, name, values, value) =>
    `<label class="field"><span>${esc(label)}</span><select name="${name}">${values.map((v) => `<option ${v === value ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
  const errorBox = (msg) =>
    msg
      ? `<div class="note" role="alert" style="border-color:#e8b9b0;color:#8b3326">${esc(msg)}</div>`
      : "";
  async function api(path, options = {}) {
    const res = await fetch("/api/v1" + path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Growth-Client": "web" },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let data;
    try {
      data = res.status === 204 ? null : await res.json();
    } catch {
      throw Error("The workspace service is unavailable. Please try again.");
    }
    if (!res.ok) {
      const e = new Error(data.error?.message || "Unable to complete request.");
      e.status = res.status;
      e.details = data.error?.details;
      if (res.status === 401) {
        clearCrawlState();
        live.user = null;
        live.orgs = [];
        live.sessions = [];
        live.securityEvents = [];
        live.org = null;
        live.sites = [];
        live.members = [];
        live.invites = [];
        live.audit = [];
      }
      throw e;
    }
    return data;
  }
  const auditQuery = (cursor) => {
    const params = new URLSearchParams(live.auditFilters);
    if (cursor) params.set("cursor", cursor);
    return "?" + params.toString();
  };
  const orgPath = (s) => `/organizations/${live.org._id}${s}`;
  async function refresh() {
    const generation = ++live.generation;
    live.loading = true;
    live.error = "";
    render();
    try {
      const user = await api("/auth/me");
      const organizations = user.emailVerifiedAt ? await api("/organizations") : { items: [] };
      if (generation !== live.generation) return;
      live.user = user;
      live.orgs = organizations.items;
      const previousOrg = live.org?._id;
      live.org =
        live.orgs.find((o) => o._id === live.org?._id) || live.orgs[0] || null;
      if (previousOrg !== live.org?._id) clearCrawlState();
      await loadTab(generation);
    } catch (e) {
      if (generation !== live.generation) return;
      if (e.status !== 401) live.error = e.message;
    } finally {
      if (generation === live.generation) {
        live.loading = false;
        render();
      }
    }
  }
  async function loadTab(generation = live.generation) {
    if (live.tab === "Account" && live.user) {
      const [sessions, events] = await Promise.all([api("/auth/sessions"), api("/auth/security-events")]);
      if (generation === live.generation) { live.sessions = sessions.items; live.securityEvents = events.items; }
      return;
    }
    if (!live.org) return;
    const base = orgPath("");
    if (live.crawlSite && ["Crawls", "URL Inventory", "Crawl issues"].includes(live.tab)) {
      const path = base + "/websites/" + live.crawlSite._id;
      if (live.tab === "Crawls") {
        const [jobs, summary] = await Promise.all([api(path + "/crawls"), api(path + "/crawl-summary")]);
        if (generation === live.generation) { live.crawls = jobs.items; live.cursor = jobs.nextCursor; live.crawlSummary = summary; }
      } else if (live.tab === "URL Inventory") {
        const params = new URLSearchParams({ ...live.urlFilters, page: String(live.urlPage) });
        const result = await api(path + "/urls?" + params);
        if (generation === live.generation) { live.urlItems = result.items; live.urlTotal = result.total; }
      } else if (live.crawlFocus) {
        const prefix = path + "/crawls/" + live.crawlFocus;
        const [issues, robots, sitemaps, errors] = await Promise.all([api(prefix + "/issues"), api(prefix + "/robots"), api(prefix + "/sitemaps"), api(prefix + "/errors")]);
        if (generation === live.generation) live.crawlReport = { issues, robots, sitemaps, errors };
      }
      return;
    }
    let data;
    if (live.tab === "Websites") {
      data = await api(base + "/websites");
      if (generation === live.generation) {
        live.sites = data.items;
        live.cursor = data.nextCursor;
      }
    }
    if (live.tab === "Team & roles" && isManager()) {
      const [m, i] = await Promise.all([
        api(base + "/memberships"),
        api(base + "/invitations"),
      ]);
      if (generation === live.generation) {
        live.members = m.items;
        live.invites = i.items;
      }
    }
    if (live.tab === "Audit logs" && isManager()) {
      data = await api(base + "/audit-logs" + auditQuery());
      if (generation === live.generation) {
        live.audit = data.items;
        live.cursor = data.nextCursor;
      }
    }
  }
  async function changeTab(tab) {
    live.tab = tab;
    live.cursor = null;
    live.loading = true;
    live.error = "";
    const gen = ++live.generation;
    render();
    try {
      await loadTab(gen);
    } catch (e) {
      if (gen === live.generation) live.error = e.message;
    } finally {
      if (gen === live.generation) {
        live.loading = false;
        render();
      }
    }
  }
  function showForm(title, content, submit, handler) {
    modal(
      title,
      `<form id="live-form">${content}<div id="live-error"></div><div class="actions" style="margin-top:24px"><button class="btn primary" type="submit">${esc(submit)}</button></div></form>`,
    );
    document.getElementById("live-form").onsubmit = async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (!form.reportValidity()) return;
      const b = form.querySelector("[type=submit]");
      b.disabled = true;
      document.getElementById("live-error").innerHTML = "";
      try {
        await handler(Object.fromEntries(new FormData(form)));
      } catch (err) {
        document.getElementById("live-error").innerHTML = errorBox(
          err.message +
            (err.details
              ? " " +
                err.details.map((d) => `${d.field}: ${d.message}`).join(" ")
              : ""),
        );
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    };
    bindLive();
  }
  function authForm(register = false) {
    showForm(
      register ? "Create your account" : "Sign in to your workspace",
      `${register ? input("Full name", "name") : ""}${input("Email address", "email", "", "email")}${input("Password (at least 12 characters)", "password", "", "password")}<p class="helper">Your account opens a real workspace. Demo records are kept separate.</p>${!register ? button("Forgot password?", "forgot-password") : ""}${button(register ? "Already have an account?" : "Create an account", register ? "sign-in" : "sign-up")}`,
      register ? "Create account" : "Sign in",
      async (data) => {
        await api(register ? "/auth/register" : "/auth/login", {
          method: "POST",
          body: data,
        });
        closeModal();
        await refresh();
        if (location.hash.includes("invite=")) acceptInviteForm();
      },
    );
  }
  function orgForm(edit = false) {
    const o = edit ? live.org : {};
    showForm(
      edit ? "Workspace preferences" : "Create a workspace",
      input("Organization name", "name", o.name) +
        input("Timezone", "timezone", o.timezone || "Asia/Kolkata") +
        input("Currency", "currency", o.currency || "INR"),
      edit ? "Save changes" : "Create workspace",
      async (data) => {
        const r = await api(edit ? orgPath("") : "/organizations", {
          method: edit ? "PATCH" : "POST",
          body: { ...data, ...(edit ? { version: o.version } : {}) },
        });
        live.org = { ...r, role: edit ? o.role : "Owner" };
        closeModal();
        await refresh();
        notify("Workspace saved.");
      },
    );
  }
  function siteForm(site) {
    showForm(
      site ? "Edit website" : "Add a website",
      input("Website name", "name", site?.name) +
        input("Domain", "domain", site?.domain || "") +
        select(
          "CMS",
          "cmsType",
          ["WordPress", "Webflow", "Shopify", "Custom", "Other"],
          site?.cmsType || "WordPress",
        ) +
        (site
          ? select("Status", "status", ["active", "archived"], site.status)
          : "") +
        '<p class="helper">Add your domain first, then verify ownership using a DNS record.</p>',
      site ? "Save website" : "Add website",
      async (data) => {
        if (site && data.status === "archived" && site.status !== "archived") {
          showForm("Archive website", '<p class="helper">This website will be archived. You can restore it later by changing its status.</p>', "Confirm archive", async () => {
            await api(orgPath("/websites/" + site._id), { method: "PATCH", body: { ...data, version: site.version } });
            closeModal(); await changeTab("Websites"); notify("Website archived.");
          });
          return;
        }
        await api(orgPath("/websites" + (site ? "/" + site._id : "")), {
          method: site ? "PATCH" : "POST",
          body: { ...data, ...(site ? { version: site.version } : {}) },
        });
        closeModal();
        await changeTab("Websites");
        notify("Website saved.");
      },
    );
  }
  function acceptInviteForm() {
    const token =
      new URLSearchParams(location.hash.split("?")[1] || "").get("invite") ||
      "";
    showForm(
      "Accept workspace invitation",
      input("Invitation token", "token", token) +
        '<p class="helper">Sign in with the email address on the invitation. Links expire after seven days.</p>',
      "Accept invitation",
      async (data) => {
        const r = await api("/invitations/accept", {
          method: "POST",
          body: data,
        });
        live.org = { _id: r.orgId };
        history.replaceState(null, "", location.pathname + "#settings");
        closeModal();
        await refresh();
        notify("You joined the workspace.");
      },
    );
  }
  function workspacePicker() {
    modal(
      "Your workspaces",
      `<div style="display:grid;gap:10px">${live.orgs.map((o) => button(`${o.name} · ${o.role}`, "switch:" + o._id)).join("")}${button("Create workspace", "create-org")}${button("Accept invitation", "accept-invite")}${button("Account & security", "account")}${button("Sign out", "sign-out")}</div>`,
    );
    bindLive();
  }
  function accountContent() {
    return header("Account & security", "Manage your profile, password and signed-in devices.") + errorBox(live.error) +
      `<section class="card padded"><h3>${esc(live.user.name)}</h3><p class="helper">${esc(live.user.email)}</p>${badge(live.user.emailVerifiedAt ? "Verified" : "Verification required")}<div class="actions" style="margin-top:20px">${button("Edit profile", "edit-profile", true)}${button("Change password", "change-password")}${!live.user.emailVerifiedAt ? button("Send verification email", "send-verification") : ""}${button("Back to workspace", "back-workspace")}</div></section>
      <section class="card padded" style="margin-top:20px"><div class="card-head"><h2>Signed-in devices</h2>${button("Sign out all devices", "logout-all")}</div><p class="helper">Device labels come from the browser and are approximate. Up to 100 active sessions are shown.</p>${live.sessions.length ? live.sessions.map(session => `<div class="knowledge"><div style="min-width:0;overflow-wrap:anywhere"><strong>${esc(session.userAgent)}</strong><small>Signed in ${esc(new Date(session.createdAt).toLocaleString())} · Expires ${esc(new Date(session.expiresAt).toLocaleString())}</small></div>${session.current ? badge("This device") : ""}${button("Sign out", "revoke-session:" + session._id)}</div>`).join("") : '<p class="helper">No active sessions loaded.</p>'}${button("Refresh devices", "account")}</section>
      <section class="card padded" style="margin-top:20px"><h3>Recent account activity</h3>${live.securityEvents.length ? live.securityEvents.map(event => `<div class="knowledge"><strong>${esc(event.action)}</strong><small>${esc(new Date(event.createdAt).toLocaleString())}</small></div>`).join("") : '<p class="helper">No security events yet.</p>'}</section>`;
  }
  function tokenForm(kind, token) {
    showForm(kind === "verify" ? "Verify your email" : "Choose a new password",
      kind === "verify" ? '<p class="helper">Confirm your email to access workspace data. Verification links expire after 24 hours.</p>' : input("New password (at least 12 characters)", "newPassword", "", "password") + '<p class="helper">This signs you out of every device. Reset links expire after 30 minutes.</p>',
      kind === "verify" ? "Verify email" : "Reset password", async data => {
        const result = await api(kind === "verify" ? "/auth/email-verification/complete" : "/auth/password-reset/complete", { method: "POST", body: { token, ...data } });
        closeModal(); await refresh(); notify(result.message);
        if (!live.user) authForm();
      });
  }
  const knowledge = { key: "", site: "", kind: "", catalog: {}, rows: [], cursor: null, search: "", status: "", loading: false, error: "", sequence: 0 };
  const knowledgePage = () => ["brand","research","strategy"].includes(state.page);
  const knowledgeWrite = () => ["Owner","Admin","Marketing Manager","SEO Manager","Content Writer"].includes(live.org?.role);
  const knowledgePath = () => orgPath("/websites/"+knowledge.site+"/knowledge");
  async function loadKnowledge(more=false) {
    const seq=++knowledge.sequence, scope=live.org?._id, page=state.page;
    knowledge.loading=true;knowledge.error="";render();
    try {
      const sites=await api(orgPath("/websites?limit=100"));
      if(seq!==knowledge.sequence||scope!==live.org?._id||page!==state.page)return;
      live.sites=sites.items.filter(s=>s.status==="active");
      if(!live.sites.some(s=>s._id===knowledge.site))knowledge.site=live.sites[0]?._id||"";
      if(!knowledge.site){knowledge.rows=[];knowledge.catalog={};return;}
      const definitions=await api(knowledgePath()+"/catalog");
      if(seq!==knowledge.sequence||scope!==live.org?._id||page!==state.page)return;
      knowledge.catalog=definitions.catalog;
      if(knowledge.catalog[knowledge.kind]?.module!==page)knowledge.kind=Object.keys(knowledge.catalog).find(k=>knowledge.catalog[k].module===page);
      const params=new URLSearchParams({kind:knowledge.kind,...(knowledge.search?{search:knowledge.search}:{}),...(knowledge.status?{status:knowledge.status}:{}),...(more&&knowledge.cursor?{cursor:knowledge.cursor}:{})});
      const result=await api(knowledgePath()+"?"+params);
      if(seq!==knowledge.sequence||scope!==live.org?._id||page!==state.page)return;
      knowledge.rows=more?[...knowledge.rows,...result.items]:result.items;knowledge.cursor=result.nextCursor;
    } catch(e){if(seq===knowledge.sequence)knowledge.error=e.message;}
    finally {if(seq===knowledge.sequence){knowledge.loading=false;render();}}
  }
  function knowledgeContent(){
    const key=live.org._id+":"+state.page;
    if(knowledge.key!==key){knowledge.key=key;knowledge.rows=[];knowledge.cursor=null;knowledge.search="";knowledge.status="";knowledge.site="";queueMicrotask(()=>loadKnowledge());return header("Your knowledge workspace","Loading saved records…");}
    const title=modules.find(m=>m[0]===state.page)[1];
    const d=knowledge.catalog[knowledge.kind];
    const toolbar=`<section class="card padded"><div class="actions">${button("Choose website","knowledge-site")}${state.page==="brand"?button("Brand Memory","knowledge-memory"):button("Research context","knowledge-context")+button("Coverage gaps","knowledge-gaps")+(state.page==="strategy"?button("Planning calendar","knowledge-calendar"):"")}${button("Filter","knowledge-filter")}${button("Refresh","knowledge-refresh")}</div><p class="helper">${esc(live.sites.find(s=>s._id===knowledge.site)?.name||"Add a website in Settings to begin.")}</p></section>`;
    const tabsHtml=`<div class="tabs">${Object.entries(knowledge.catalog).filter(([,v])=>v.module===state.page).map(([k,v])=>`<button data-live="knowledge-tab:${k}" class="${knowledge.kind===k?"active":""}">${esc(v.label)}</button>`).join("")}</div>`;
    const rows=knowledge.rows;
    return header(title,state.page==="brand"?"Trusted business knowledge, with sources and approvals.":"Evidence-backed research and a plan your team can act on.")+toolbar+tabsHtml+errorBox(knowledge.error)+(knowledge.loading?'<section class="card padded" role="status"><div class="skeleton-bar"></div><p>Loading saved records…</p></section>':`<section class="card"><div class="card-head"><div><h2>${esc(d?.label||title)}</h2><p>Saved workspace records</p></div>${knowledge.site&&knowledgeWrite()?button("Add record","knowledge-new",true)+(knowledge.kind==="media"?button("Upload file","knowledge-upload"):"")+(knowledge.kind==="sources"?button("Import crawl page","knowledge-import"):""):""}</div>${rows.length?`<div class="table-scroll"><table><thead><tr><th>Name</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.title)}<small>${esc(r.data.dueDate||r.data.reviewDate||r.data.source||"")}</small></td><td>${badge(r.status)}</td><td>${esc(new Date(r.updatedAt).toLocaleDateString())}</td><td><div class="actions">${button("View","knowledge-view:"+r._id)}${knowledgeWrite()?button("Edit","knowledge-edit:"+r._id)+(r.status!=="archived"?button("Archive","knowledge-archive:"+r._id):""):""}</div></td></tr>`).join("")}</tbody></table></div>`:'<div class="empty"><strong>No records yet</strong>Create a record or change your filters. No sample data is used.</div>'}${knowledge.cursor?button("Load more","knowledge-more"):""}</section>`);
  }
  async function knowledgeForm(record){
    const kind=record?.kind||knowledge.kind,d=knowledge.catalog[kind],path=knowledgePath(),scope=live.org._id;
    const choices=await api(path+"/options"+(record?"?current="+record._id:""));if(scope!==live.org?._id)return;
    const canApprove=["Owner","Admin","Marketing Manager"].includes(live.org.role);
    const statuses=["draft","in_review",...(canApprove?["approved"]:[]),"in_progress","completed"];
    const content=input("Name","title",record?.title||"")+select("Status","status",statuses,record?.status||"draft")+d.fields.map(f=>{
      const value=record?.data?.[f.key]??"";
      if(f.key==="owner")return `<label class="field"><span>${esc(f.label.replace(" user ID",""))}</span><select name="owner"><option value="">Unassigned</option>${choices.users.map(u=>`<option value="${esc(u._id)}" ${u._id===value?"selected":""}>${esc(u.name)}</option>`).join("")}</select></label>`;
      return f.type==="long"?`<label class="field"><span>${esc(f.label)}</span><textarea name="${f.key}" maxlength="8000">${esc(value)}</textarea></label>`:input(f.label,f.key,value,f.type==="url"?"url":f.type==="number"?"number":f.type==="date"?"date":"text",false);
    }).join("")+`<label class="field"><span>Related evidence and records</span><select name="references" multiple size="5">${choices.records.filter(r=>r._id!==record?._id).map(r=>`<option value="${esc(r._id)}" ${record?.references?.includes(r._id)?"selected":""}>${esc(r.title)} · ${esc(knowledge.catalog[r.kind]?.label||r.kind)}</option>`).join("")}</select></label>${choices.truncated?'<p class="helper">Showing the first 200 choices.</p>':""}`;
    showForm((record?"Edit ":"Add ")+d.label,content,"Save record",async values=>{
      if(scope!==live.org?._id)throw Error("Workspace changed. Reopen the form.");
      const data={};for(const f of d.fields)if(values[f.key]!=="")data[f.key]=f.type==="number"?Number(values[f.key]):values[f.key];
      await api(path+"/"+(record?record._id:"records/"+kind),{method:record?"PATCH":"POST",body:{title:values.title,status:values.status,data,references:[...document.querySelector('[name="references"]').selectedOptions].map(o=>o.value),...(record?{version:record.version}:{})}});
      closeModal();await loadKnowledge();notify("Record saved.");
    });
  }
  async function knowledgeAction(key,id){
    if(key==="knowledge-refresh")return loadKnowledge();
    if(key==="knowledge-tab"){knowledge.kind=id;knowledge.cursor=null;return loadKnowledge();}
    if(key==="knowledge-more")return loadKnowledge(true);
    if(key==="knowledge-new")return knowledgeForm();
    if(key==="knowledge-import"){
      const path=knowledgePath(),scope=live.org._id,result=await api(path+"/context");if(scope!==live.org?._id)return;
      if(!result.pages.length)throw Error("Complete a crawl before importing page knowledge.");
      return showForm("Import crawled metadata",`<label class="field"><span>Crawled page</span><select name="pageId">${result.pages.map(p=>`<option value="${esc(p._id)}">${esc(p.url)}</option>`).join("")}</select></label><p class="helper">Imports title and description with crawl provenance as a draft source. Review before approval.</p>`,"Import",async data=>{await api(path+"/import-page",{method:"POST",body:data});closeModal();await loadKnowledge();notify("Source imported for review.");});
    }
    if(key==="knowledge-upload")return showForm("Upload media",'<label class="field"><span>PNG, JPEG, WebP or PDF · up to 2 MB</span><input name="asset" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required></label><p class="helper">Files are stored privately with your website. Videos can be added as linked assets.</p>',"Upload",async()=>{
      const file=document.querySelector('[name="asset"]').files[0];if(!file||file.size>2*1024*1024)throw Error("Choose a file up to 2 MB.");
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(Error("File could not be read."));reader.readAsDataURL(file);});
      await api(knowledgePath()+"/upload",{method:"POST",body:{name:file.name,type:file.type,base64}});closeModal();await loadKnowledge();notify("File uploaded.");
    });
    if(key==="knowledge-site")return showForm("Choose website",`<label class="field"><span>Website</span><select name="site">${live.sites.map(s=>`<option value="${esc(s._id)}" ${s._id===knowledge.site?"selected":""}>${esc(s.name)}</option>`).join("")}</select></label>`,"Open",async data=>{knowledge.site=data.site;knowledge.cursor=null;closeModal();await loadKnowledge();});
    if(key==="knowledge-filter")return showForm("Filter records",input("Search names","search",knowledge.search,"text",false)+select("Status","status",["","draft","in_review","approved","in_progress","completed","archived"],knowledge.status),"Apply",async data=>{knowledge.search=data.search;knowledge.status=data.status;knowledge.cursor=null;closeModal();await loadKnowledge();});
    if(key==="knowledge-calendar")return showForm("Planning calendar",input("From","from",new Date().toISOString().slice(0,10),"date")+input("To","to",new Date(Date.now()+30*86400000).toISOString().slice(0,10),"date"),"Show tasks",async data=>{
      const result=await api(knowledgePath()+"/calendar?"+new URLSearchParams(data));
      modal("Planning calendar",result.items.map(t=>`<div class="knowledge"><div><strong>${esc(t.title)}</strong><small>${esc(t.data.dueDate)} · ${esc(t.status)}</small></div></div>`).join("")||'<div class="empty">No tasks due in this period.</div>',"",true);
    });
    if(!knowledge.site)throw Error("Add a website in Settings first.");
    const seq=knowledge.sequence,path=knowledgePath();
    if(key==="knowledge-gaps"){
      const result=await api(path+"/gaps");if(seq!==knowledge.sequence)return;
      modal("Content coverage candidates",`<p class="helper">${esc(result.method)}</p><p>${result.sampledPages} pages sampled${result.truncated?" · Coverage limit reached":""}</p>${result.items.map(r=>`<div class="knowledge"><div><strong>${esc(r.title)}</strong><p>${esc(r.reason)}</p><small>${esc(r.recommendation)}</small><small>Source: ${esc(r.recordId)}</small></div></div>`).join("")||'<div class="empty">No candidates. Add topics/keywords and complete a crawl to compare coverage.</div>'}`,"",true);return;
    }
    if(key==="knowledge-memory"||key==="knowledge-context"){
      const result=await api(path+(key==="knowledge-memory"?"/memory":"/context"));if(seq!==knowledge.sequence)return;
      const items=result.items||result.memory?.items||[];
      modal(key==="knowledge-memory"?"Approved Brand Memory":"Research context",`<p class="helper">${esc(result.policy||result.coverage)}</p>${items.length?items.map(r=>`<div class="knowledge"><div><strong>${esc(r.title)}</strong><small>${esc(r.kind)} · version ${r.version} · ${esc(r._id)}</small></div></div>`).join(""):'<div class="empty">No approved, current brand knowledge yet.</div>'}${result.pages?`<h3>Crawled pages</h3>${result.pages.map(p=>`<div class="knowledge"><div><strong>${esc(p.data?.title||p.url)}</strong><small>${esc(p.url)}</small></div></div>`).join("")||'<p class="helper">Complete a crawl to add page evidence.</p>'}<h3>Competitors</h3>${result.competitors.map(c=>`<p>${esc(c.title)} — ${esc(c.data.url||"")}</p>`).join("")||'<p class="helper">Add competitor records in Brand & Knowledge.</p>'}`:""}`,"",true);return;
    }
    const r=await api(path+"/"+id);if(seq!==knowledge.sequence)return;
    if(key==="knowledge-edit")return knowledgeForm(r);
    if(key==="knowledge-view")return modal(r.title,`${badge(r.status)}${r.fileId?`<p><a class="btn" href="/api/v1${esc(path)}/${esc(r._id)}/download">Download file</a></p>`:""}<p class="helper">Record ID: ${esc(r._id)} · Version ${r.version}</p>${knowledge.catalog[r.kind].fields.map(f=>`<div class="knowledge"><div><small>${esc(f.label)}</small><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.data[f.key]??"Not provided")}</p></div></div>`).join("")}<p class="helper">Related records: ${esc(r.references.join(", ")||"None")}</p>`,"",true);
    if(key==="knowledge-archive")return showForm("Archive record",`<p>Archive ${esc(r.title)}? It will be excluded from Brand Memory.</p>`,"Archive",async()=>{await api(path+"/"+id,{method:"PATCH",body:{title:r.title,status:"archived",data:r.data,references:r.references,version:r.version}});closeModal();await loadKnowledge();notify("Record archived.");});
  }

  const cms = { key:"", site:"", rows:[], jobs:[], connection:null, config:null, templates:[], cursor:null, search:"", status:"", loading:false, error:"", seq:0 };
  const contentPath = suffix => orgPath("/websites/"+cms.site+"/content"+(suffix||""));
  const wpPath = suffix => orgPath("/websites/"+cms.site+"/cms"+(suffix||""));
  const canPublish = () => ["Owner","Admin","Marketing Manager"].includes(live.org?.role);
  async function loadContent(more=false){
    const seq=++cms.seq,org=live.org._id;cms.loading=true;cms.error="";render();
    try{
      const sites=await api(orgPath("/websites?limit=100"));if(seq!==cms.seq||org!==live.org?._id)return;
      live.sites=sites.items.filter(s=>s.status==="active");if(!live.sites.some(s=>s._id===cms.site))cms.site=live.sites[0]?._id||"";
      if(!cms.site){cms.rows=[];return;}
      const query=new URLSearchParams({...cms.search?{search:cms.search}:{},...cms.status?{status:cms.status}:{},...more&&cms.cursor?{cursor:cms.cursor}:{}});
      const [items,config,jobs,templates]=await Promise.all([api(contentPath("?"+query)),api(wpPath()),api(wpPath("/jobs")),api(contentPath("/templates"))]);
      if(seq!==cms.seq||org!==live.org?._id)return;cms.rows=more?[...cms.rows,...items.items]:items.items;cms.cursor=items.nextCursor;cms.config=config;cms.connection=config.connection;cms.jobs=jobs.items;cms.templates=templates.items;
    }catch(e){if(seq===cms.seq)cms.error=e.message;}finally{if(seq===cms.seq){cms.loading=false;render();}}
  }
  function contentPanel(){
    if(cms.key!==live.org._id){cms.key=live.org._id;cms.site="";cms.rows=[];queueMicrotask(()=>loadContent());return header("Content & AI CMS","Loading saved content…");}
    return header("Content that moves your business forward.","Create, review and publish from one connected workspace.")+`<div class="actions">${button("Choose website","content-site")}${button("Filter","content-filter")}${button("Refresh","content-refresh")}${canPublish()?button("WordPress","content-wordpress"):""}${button("Publishing log","content-jobs")}${button("Refresh candidates","content-refresh-candidates")}${button("Templates","content-templates")}</div><p class="helper">${esc(live.sites.find(s=>s._id===cms.site)?.name||"Add a website in Settings first.")}</p>`+errorBox(cms.error)+(cms.loading?'<section class="card padded" role="status"><div class="skeleton-bar"></div><p>Loading content…</p></section>':`<section class="card"><div class="card-head"><div><h2>Your content library</h2><p>Ideas, briefs, reviews and published revisions.</p></div>${cms.site&&knowledgeWrite()?button("Create content","content-new",true):""}</div>${cms.rows.length?`<div class="table-scroll"><table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${cms.rows.map(r=>`<tr><td>${esc(r.title)}<small>/${esc(r.slug)}</small></td><td>${esc(r.type)}</td><td>${badge(r.status)}</td><td>${esc(new Date(r.updatedAt).toLocaleDateString())}</td><td>${button("Open","content-open:"+r._id)}${button("History","content-history:"+r._id)}</td></tr>`).join("")}</tbody></table></div>`:'<div class="empty"><strong>No content yet</strong>Create your first idea or adjust your filters.</div>'}${cms.cursor?button("Load more","content-more"):""}</section>`);
  }
  let contentUnsaved=()=>false;
  const closeContentModal=closeModal;
  closeModal=function(){if(contentUnsaved()){const target=document.querySelector('#editor-error')||document.querySelector('#template-error');if(target)target.innerHTML=errorBox('Save your changes before closing.');return;}contentUnsaved=()=>false;return closeContentModal();};
  window.addEventListener('beforeunload',event=>{if(contentUnsaved()){event.preventDefault();event.returnValue='';}});
  async function contentEditor(id){
    const path=contentPath(),site=cms.site,org=live.org._id;
    let item=await api(path+"/"+id);const choices=knowledgeWrite()?await api(orgPath("/websites/"+site+"/knowledge/options")):{records:[],users:[]};
    if(site!==cms.site||org!==live.org?._id)return;
    const editable=knowledgeWrite()&&!["scheduled","publishing","archived"].includes(item.status);
    for(const [ids,kind] of [[item.evidenceIds,'source'],[item.mediaIds,'media']])for(const key of ids)if(!choices.records.some(r=>r._id===key))choices.records.push({_id:key,kind,title:'Linked record '+key+' (not in current choices)'});
    if(item.ownerId&&!choices.users.some(u=>u._id===item.ownerId))choices.users.push({_id:item.ownerId,name:'Assigned teammate '+item.ownerId});
    let blocks=item.blocks.length?item.blocks:[{type:"paragraph",text:""}],dirty=false,saving=false,timer;contentUnsaved=()=>!!document.querySelector('#content-editor')&&(dirty||saving);
    const selected=(name,values,options)=>`<label class="field"><span>${name==="mediaIds"?"Media references":"Evidence and brief sources"}</span><select name="${name}" multiple size="4">${options.map(o=>`<option value="${esc(o._id)}" ${values.includes(o._id)?"selected":""}>${esc(o.title)}</option>`).join("")}</select></label>`;
    function values(){const form=document.querySelector('#content-editor'),data=Object.fromEntries(new FormData(form));return {title:data.title,slug:data.slug,type:data.type,brief:data.brief,seoTitle:data.seoTitle,description:data.description,ownerId:data.ownerId||null,featuredMediaId:data.featuredMediaId||null,keywords:data.keywords.split(',').map(x=>x.trim()).filter(Boolean),categories:data.categories.split(',').map(x=>x.trim()).filter(Boolean).map(Number),tags:data.tags.split(',').map(x=>x.trim()).filter(Boolean).map(Number),evidenceIds:[...form.querySelector('[name="evidenceIds"]').selectedOptions].map(o=>o.value),mediaIds:[...form.querySelector('[name="mediaIds"]').selectedOptions].map(o=>o.value),blocks:blocks.map((b,i)=>({type:data['type'+i],text:data['text'+i],...(data['type'+i]==='heading'?{level:Number(data['level'+i])}:{})}))};}
    async function save(){if(saving||!dirty)return;const form=document.querySelector('#content-editor');if(!form||!form.reportValidity())return;saving=true;const submitted=JSON.stringify(values());form.querySelector('#save-state').textContent='Saving…';try{const result=await api(path+'/'+id,{method:'PATCH',body:{...JSON.parse(submitted),version:item.version}});item={...item,...result};dirty=JSON.stringify(values())!==submitted;form.querySelector('#save-state').textContent=dirty?'Unsaved changes':'Saved';form.querySelector('#editor-error').innerHTML='';if(dirty&&item.status==='draft')timer=setTimeout(()=>save().catch(()=>{}),1500);}catch(e){clearTimeout(timer);form.querySelector('#editor-error').innerHTML=errorBox(e.message);form.querySelector('#save-state').textContent='Not saved';throw e;}finally{saving=false;}}
    function draw(){modal(esc(item.title),`<form id="content-editor"><fieldset ${editable?'':'disabled'} style="border:0;padding:0">${input("Title","title",item.title)}${input("Slug","slug",item.slug)}${select("Type","type",["post","page"],item.type)}<label class="field"><span>Brief, objective, audience and CTA</span><textarea name="brief">${esc(item.brief)}</textarea></label><label class="field"><span>Owner</span><select name="ownerId"><option value="">Unassigned</option>${choices.users.map(u=>`<option value="${esc(u._id)}" ${u._id===item.ownerId?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>${blocks.map((b,i)=>`<section class="card padded">${select("Block "+(i+1),'type'+i,['paragraph','heading','quote','list'],b.type)}${select("Heading level",'level'+i,['2','3','4','5','6'],String(b.level||2))}<label class="field"><span>Text${b.type==='list'?' (one item per line)':''}</span><textarea name="text${i}" maxlength="8000">${esc(b.text)}</textarea></label><button type="button" class="btn" data-block-up="${i}">Move up</button><button type="button" class="btn" data-block-remove="${i}">Remove block</button></section>`).join('')}<button type="button" class="btn" id="add-block">Add paragraph</button>${input("SEO title","seoTitle",item.seoTitle,"text",false)}${input("Meta description","description",item.description,"text",false)}${input("Keywords (comma separated)","keywords",item.keywords.join(', '),"text",false)}${input("WordPress category IDs (optional)","categories",item.categories.join(', '),"text",false)}${input("WordPress tag IDs (optional)","tags",item.tags.join(', '),"text",false)}${selected('evidenceIds',item.evidenceIds,choices.records)}${selected('mediaIds',item.mediaIds,choices.records.filter(r=>r.kind==='media'))}<label class="field"><span>Featured image (uploaded to WordPress on publishing)</span><select name="featuredMediaId"><option value="">Keep current remote image / no new image</option>${choices.records.filter(r=>r.kind==='media').map(r=>`<option value="${esc(r._id)}" ${r._id===item.featuredMediaId?'selected':''}>${esc(r.title)}</option>`).join('')}${item.featuredMediaId&&!choices.records.some(r=>r._id===item.featuredMediaId)?`<option selected value="${esc(item.featuredMediaId)}">Current image ${esc(item.featuredMediaId)}</option>`:''}</select></label></fieldset><p id="save-state" role="status">${dirty?'Unsaved changes':esc(item.status)+' · revision '+item.revision}</p><div id="editor-error"></div><div class="actions">${editable?'<button type="submit" class="btn primary">Save</button>':''}${button("Preview & checks","content-preview:"+id)}${editable?button("AI assistance","content-ai:"+id):''}${knowledgeWrite()?button("Workflow","content-workflow:"+id):''}${canPublish()?button("Publish / schedule","content-publish:"+id):''}${canPublish()?button("Save template","content-template:"+id)+button("Compare WordPress","content-remote-compare:"+id):''}</div></form>`,"",true);
      const form=document.querySelector('#content-editor');form.onsubmit=async e=>{e.preventDefault();dirty=true;try{await save();notify('Content saved.');}catch{}};
      form.oninput=()=>{dirty=true;form.querySelector('#save-state').textContent='Unsaved changes';clearTimeout(timer);if(item.status==='draft')timer=setTimeout(()=>save().catch(()=>{}),1500);};
      const change=fn=>{clearTimeout(timer);Object.assign(item,values());blocks=item.blocks;fn();dirty=true;draw();};
      form.querySelector('#add-block').onclick=()=>change(()=>blocks.push({type:'paragraph',text:''}));
      form.querySelectorAll('[data-block-up]').forEach(b=>b.onclick=()=>change(()=>{const i=Number(b.dataset.blockUp);if(i)[blocks[i-1],blocks[i]]=[blocks[i],blocks[i-1]];}));
      form.querySelectorAll('[data-block-remove]').forEach(b=>b.onclick=()=>change(()=>blocks.splice(Number(b.dataset.blockRemove),1)));
      form.querySelectorAll('[data-live]').forEach(b=>b.onclick=async()=>{try{if(dirty){await save();if(dirty||saving)return;}await run(b.dataset.live);}catch{}});
      form.querySelectorAll('[data-live]').forEach(b=>{if(!editable&&b.dataset.live.startsWith('content-ai'))b.remove();});
      document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(dirty){form.querySelector('#editor-error').innerHTML=errorBox('Save your changes before closing.');return;}clearTimeout(timer);closeModal();void loadContent();});
    }draw();
  }
  async function templateList(){const r=await api(contentPath('/templates'));cms.templates=r.items;modal('Templates & composer',`<p class="helper">Approved reusable blocks. Design guidance is saved with each approved version.</p>${knowledgeWrite()?button('Create template','content-template-new',true):''}`+(r.items.map(t=>`<div class="knowledge"><div><strong>${esc(t.name)}</strong><small>${esc(t.contentType||'post')} · ${esc(t.variant||'Default')} · ${badge(t.status)} · v${t.version}</small></div>${button('Open','content-template-open:'+t._id)}</div>`).join('')||'<div class="empty">No saved templates yet.</div>'),'',true);bindLive();}
  async function templateEditor(id){
    const path=contentPath('/templates'),site=cms.site,org=live.org._id;
    let t=id?await api(path+'/'+id):{name:'',contentType:'post',variant:'Default',blocks:[],status:'draft',version:0,designProfileId:null};
    const profiles=(await api(orgPath('/websites/'+site+'/knowledge?kind=design&status=approved'))).items;
    if(site!==cms.site||org!==live.org?._id)return;
    let dirty=false,saving=false;contentUnsaved=()=>!!document.querySelector('#template-editor')&&(dirty||saving);let blocks=t.blocks.length?t.blocks:[{type:'paragraph',text:''}];const editable=knowledgeWrite()&&t.status!=='archived';
    const read=()=>{const f=document.querySelector('#template-editor'),d=Object.fromEntries(new FormData(f));return {name:d.name,contentType:d.contentType,variant:d.variant,mapping:'basic_html',designProfileId:d.designProfileId||null,blocks:blocks.map((b,i)=>({type:d['type'+i],text:d['text'+i],...(d['type'+i]==='heading'?{level:Number(d['level'+i])}:{})}))};};
    function draw(){modal(id?'Edit template':'Create template',`<form id="template-editor"><fieldset ${editable?'':'disabled'} style="border:0;padding:0">${input('Name','name',t.name)}${select('Content type','contentType',['post','page'],t.contentType||'post')}${input('Variant label','variant',t.variant||'Default')}<label class="field"><span>Approved design profile</span><select name="designProfileId"><option value="">No design binding</option>${profiles.map(p=>`<option value="${esc(p._id)}" ${p._id===t.designProfileId?'selected':''}>${esc(p.title)} · v${p.version}</option>`).join('')}${t.designProfileId&&!profiles.some(p=>p._id===t.designProfileId)?`<option selected value="${esc(t.designProfileId)}">Previous design (review required)</option>`:''}</select></label>${t.designOutdated?'<div class="note">The linked design profile changed. Save this template with an approved current profile and request review again.</div>':''}<p class="helper">WordPress mapping: safe basic HTML. Custom theme layouts and arbitrary CSS are not inserted.</p>${blocks.map((b,i)=>`<section class="card padded">${select('Block '+(i+1),'type'+i,['paragraph','heading','quote','list'],b.type)}${select('Heading level','level'+i,['2','3','4','5','6'],String(b.level||2))}<label class="field"><span>Text</span><textarea name="text${i}" maxlength="8000">${esc(b.text)}</textarea></label><button type="button" class="btn" data-template-up="${i}">Move up</button><button type="button" class="btn" data-template-remove="${i}">Remove</button></section>`).join('')}<button type="button" class="btn" id="template-add">Add paragraph</button></fieldset><div id="template-error" role="alert"></div>${editable?'<button type="submit" class="btn primary">Save draft</button>':''}</form>${id?`<p>${badge(t.status)} · version ${t.version}</p><details><summary>Saved preview and design guidance</summary><section class="card padded">${t.html||''}</section><pre style="white-space:pre-wrap">${esc(JSON.stringify(t.designSnapshot?.data||{},null,2))}</pre></details>${knowledgeWrite()&&t.status!=='archived'?'<button class="btn" id="template-decision">Review / archive</button>':''}`:''}`,'',true);
      const f=document.querySelector('#template-editor');f.oninput=()=>{dirty=true;};f.onsubmit=async e=>{e.preventDefault();const button=f.querySelector('[type="submit"]');button.disabled=true;saving=true;try{const result=await api(path+(id?'/'+id:''),{method:id?'PATCH':'POST',body:{...read(),...(id?{version:t.version}:{})}});dirty=false;saving=false;await templateEditor(result._id);}catch(e){f.querySelector('#template-error').innerHTML=errorBox(e.message);saving=false;button.disabled=false;}};
      const change=fn=>{Object.assign(t,read());blocks=t.blocks;fn();dirty=true;draw();};
      f.querySelector('#template-add').onclick=()=>change(()=>blocks.push({type:'paragraph',text:''}));
      f.querySelectorAll('[data-template-up]').forEach(b=>b.onclick=()=>change(()=>{const i=Number(b.dataset.templateUp);if(i)[blocks[i-1],blocks[i]]=[blocks[i],blocks[i-1]];}));
      f.querySelectorAll('[data-template-remove]').forEach(b=>b.onclick=()=>change(()=>blocks.splice(Number(b.dataset.templateRemove),1)));
      const decision=document.querySelector('#template-decision');if(decision)decision.onclick=()=>{if(dirty){f.querySelector('#template-error').innerHTML=errorBox('Save your edits before review.');return;}const options=t.status==='draft'?['review','archive']:t.status==='review'?[...(canPublish()?['approve','changes']:[]),'archive']:[...(canPublish()?['changes']:[]),'archive'];showForm('Template review',select('Action','action',options,options[0])+input('Reason (required for changes or self-approval)','reason','','text',false)+'<label class="field"><span><input name="selfApproval" type="checkbox"> Owner self-approval exception for this version</span></label><p>Review applies to the saved version. Save edits before requesting review.</p>','Confirm',async d=>{await api(path+'/'+id+'/decision',{method:'POST',body:{action:d.action,reason:d.reason,allowSelfApproval:d.selfApproval==='on',version:t.version}});await templateEditor(id);});};
    }draw();
  }
  async function contentAction(key,id){
    if(key==='content-refresh')return loadContent();if(key==='content-more')return loadContent(true);
    if(key==='content-site')return showForm('Choose website',`<label class="field"><span>Website</span><select name="site">${live.sites.map(s=>`<option value="${esc(s._id)}">${esc(s.name)}</option>`).join('')}</select></label>`,'Open',async d=>{cms.site=d.site;closeModal();await loadContent();});
    if(key==='content-filter')return showForm('Filter content',input('Search','search',cms.search,'text',false)+select('Status','status',['','idea','brief','draft','review','approved','scheduled','publishing','published','archived'],cms.status),'Apply',async d=>{cms.search=d.search;cms.status=d.status;closeModal();await loadContent();});
    if(!cms.site)throw Error('Add a website in Settings first.');
    if(key==='content-import-post'||key==='content-import-page')return showForm('Import WordPress content','<p>Import a local draft using supported text, heading, quote and list blocks. Custom layouts, embeds, images and styling are not imported. Review formatting before approving any future update to the linked WordPress record.</p>','Import simplified draft',async()=>{const item=await api(wpPath('/import'),{method:'POST',body:{type:key.endsWith('-post')?'post':'page',remoteId:Number(id),acceptSimplifiedFormatting:true}});await contentEditor(item._id);});
    if(key==='content-refresh-candidates'){const r=await api(contentPath('/refresh-candidates'));modal('Content refresh candidates',`<p class="helper">${esc(r.policy.basis)}. Threshold: ${r.policy.days} days.</p>`+(r.items.map(x=>`<div class="knowledge"><div><strong>${esc(x.title)}</strong><small>Last saved ${esc(new Date(x.updatedAt).toLocaleDateString())}</small></div>${knowledgeWrite()?button('Begin refresh','content-start-refresh:'+x._id):''}</div>`).join('')||'<div class="empty">No published content meets this review threshold.</div>'),'',true);bindLive();return;}
    if(key==='content-new'){cms.templates=(await api(contentPath('/templates'))).items;const createKey=crypto.randomUUID();return showForm('Create content',input('Title','title')+input('Slug','slug')+select('Type','type',['post','page'],'post')+`<label class="field"><span>Template</span><select name="template"><option value="">Blank</option>${cms.templates.filter(t=>t.status==='approved').map(t=>`<option value="${esc(t._id)}">${esc(t.name)}</option>`).join('')}</select></label>`,'Create idea',async d=>{const created=await api(contentPath(),{method:'POST',body:{title:d.title,slug:d.slug,type:d.type,...(d.template?{templateId:d.template,templateVersion:cms.templates.find(t=>t._id===d.template).version}:{}),idempotencyKey:createKey}});await contentEditor(created._id);});}
    if(key==='content-templates')return templateList();
    if(key==='content-template-open')return templateEditor(id);
    if(key==='content-template-new')return templateEditor();
    if(key==='content-open')return contentEditor(id);
    if(key==='content-jobs'){const result=await api(wpPath('/jobs'));modal('Publishing history',result.items.map(j=>`<div class="knowledge"><div><strong>${esc(j.operation)} · ${badge(j.status)}</strong><small>${esc(j.runAt)} · ${esc(j.error||'')}</small><small>Content ${esc(j.contentId)}</small></div>${canPublish()&&j.status==='queued'?button('Cancel','content-cancel:'+j._id):''}${canPublish()&&j.status==='needs_review'?button('Check remote outcome','content-reconcile:'+j._id):''}</div>`).join('')||'<div class="empty">No publishing jobs yet.</div>',"",true);bindLive();return;}
    if(key==='content-cancel'){const j=(await api(wpPath('/jobs'))).items.find(j=>j._id===id);return showForm('Cancel scheduled publishing','<p>The approved content will remain available.</p>','Cancel publishing',async()=>{await api(wpPath('/jobs/'+id+'/cancel'),{method:'POST',body:{version:j.version}});closeModal();await loadContent();});}
    if(key==='content-reconcile'){const r=await api(wpPath('/jobs/'+id+'/reconcile'),{method:'POST',body:{}});modal('Remote outcome',`<p>${esc(r.message)}</p>`);return;}
    if(key==='content-wordpress'){const config=await api(wpPath());cms.connection=config.connection;const c=config.connection;
      modal('WordPress connection',`<p class="helper">${esc(c?.origin||'Connect the verified domain configured in Settings.')}</p>${badge(c?.status||'Not connected')}<p class="helper">${esc(config.seoMeta)}</p>${!config.configured?'<div class="note">Server credential encryption must be configured before connecting.</div>':''}<div class="actions">${isManager()?button('Connect / replace credentials','content-connect')+(c?button('Disconnect','content-disconnect'):''):''}${c?.status==='connected'?button('Browse WordPress records','content-remote'):''}</div>`);bindLive();return;}
    if(key==='content-connect')return showForm('Connect WordPress',input('WordPress username','username')+`<label class="field"><span>WordPress application password</span><input name="applicationPassword" type="password" autocomplete="off" required></label><p class="helper">Use an application password for your verified website. It is encrypted on the server.</p>`,'Test and connect',async d=>{await api(wpPath('/connect'),{method:'POST',body:{...d,...cms.connection?{version:cms.connection.version}:{}}});closeModal();await loadContent();notify('WordPress connected.');});
    if(key==='content-disconnect')return showForm('Disconnect WordPress','<p>Remove the saved credential and block queued publishing?</p>','Disconnect',async()=>{await api(wpPath('/disconnect'),{method:'POST',body:{version:cms.connection.version}});closeModal();await loadContent();});
    if(key==='content-remote')return showForm('Browse WordPress',select('Record type','type',['posts','pages','categories','tags','users'],'posts')+input('Page','page','1','number'),'Load',async d=>{const r=await api(wpPath('/remote?'+new URLSearchParams(d)));modal('WordPress records',r.items.map(x=>`<div class="knowledge"><div><strong>${esc(x.title?.rendered||x.name||x.slug)}</strong><small>ID ${x.id} · ${esc(x.status||'')}</small></div>${['posts','pages'].includes(d.type)?button('Import as draft','content-import-'+(d.type==='posts'?'post':'page')+':'+x.id):''}</div>`).join('')||'<div class="empty">No records found.</div>',"",true);bindLive();});
    const item=await api(contentPath('/'+id));
    if(key==='content-start-refresh')return showForm('Begin content refresh',input('Reason for refresh','reason')+'<p>Your live WordPress article stays unchanged. This opens a new draft revision that requires approval before publishing.</p>','Create refresh draft',async d=>{await api(contentPath('/'+id+'/refresh'),{method:'POST',body:{reason:d.reason,version:item.version}});await contentEditor(id);});
    if(key==='content-remote-compare'){const r=await api(wpPath('/'+id+'/compare'));return showForm('Compare WordPress changes',`<h3>Saved local content</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.local.title+'\n'+r.local.blocks.map(b=>b.text).join('\n\n'))}</pre><h3>Current WordPress source</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.remote.title+'\n'+r.remote.content)}</pre>`+select('Draft to review next','choice',['keep_local','import_remote'],'keep_local')+input('Resolution reason','reason')+'<p>Keeping local content acknowledges the remote version shown. Importing simplifies remote formatting to supported text blocks. Both choices create an unapproved draft. Nothing is published by this action.</p>','Confirm draft resolution',async d=>{await api(wpPath('/'+id+'/resolve-conflict'),{method:'POST',body:{...d,version:r.localVersion,remoteHash:r.remoteHash,remoteModified:r.remoteModified,acceptSimplifiedFormatting:true}});await contentEditor(id);});}
    if(key==='content-preview'){modal('Preview & editorial checks',`<p class="helper">${item.guidance.wordCount} words · ${esc(item.guidance.note)}</p>${item.guidance.checks.map(c=>`<div class="knowledge"><span>${esc(c.name)}</span>${badge(c.ok?'Ready':'Needs review')}</div>`).join('')}<section class="card padded">${item.html}</section>`,"",true);return;}
    if(key==='content-workflow')return showForm('Content workflow',`<p>Current state: ${esc(item.status)}</p>`+select('Action','action',['brief','draft','review',...(canPublish()?['approve','changes']:[]),'archive'],'review')+input('Review reason (required for changes or Owner self-approval)','reason','','text',false)+'<label class="field"><span><input type="checkbox" name="selfApproval"> Owner: explicitly allow self-approval for this revision</span></label>'+'<p class="helper">Archive hides the item from active work. It does not delete the WordPress post.</p>','Confirm action',async d=>{await api(contentPath('/'+id+'/transition'),{method:'POST',body:{action:d.action,reason:d.reason,allowSelfApproval:d.selfApproval==='on',version:item.version}});closeModal();await loadContent();});
    if(key==='content-publish')return showForm('Publish approved content',select('Destination state','operation',['draft','publish'],'draft')+input('Schedule in UTC (optional, e.g. 2026-11-01T09:00:00Z)','runAt','','text',false)+'<p class="helper">Publishing changes your WordPress website and uploads the selected featured image publicly. Only the current approved revision can be queued. Leave scheduling blank to send now.</p>','Confirm publishing request',async d=>{await api(wpPath('/'+id+'/publish'),{method:'POST',body:{version:item.version,operation:d.operation,...d.runAt?{runAt:d.runAt}:{}}});closeModal();await loadContent();notify('Publishing queued.');});
    if(key==='content-template')return showForm('Save draft template',input('Template name','name',item.title),'Save draft',async d=>{await api(contentPath('/templates'),{method:'POST',body:{name:d.name,blocks:item.blocks,contentType:item.type}});closeModal();await loadContent();});
    if(key==='content-history'){const history=await api(contentPath('/'+id+'/versions'));modal('Version history',history.items.map(v=>`<details><summary>Revision ${v.revision} · ${esc(v.createdAt)} · ${esc(v.reason)}</summary><p>${esc(v.snapshot.title)}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(v.snapshot.blocks.map(b=>b.text).join('\n\n'))}</pre>${knowledgeWrite()?`<button class="btn" data-restore="${v.revision}">Restore as draft</button>`:''}</details>`).join(''),"",true);document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>showForm('Restore revision','<p>This creates a new draft revision and clears approval.</p>','Restore',async()=>{await api(contentPath('/'+id+'/restore'),{method:'POST',body:{version:item.version,revision:Number(b.dataset.restore)}});await contentEditor(id);}));return;}
    if(key==='content-ai')return showForm('AI writing assistance',select('Operation','operation',['draft','section','rewrite','shorten','expand','brand_voice'],'draft')+input('Instructions','instruction')+'<p class="helper">Sends this content and approved workspace knowledge to the configured AI provider. The proposal is not approved or published automatically.</p>','Generate proposal',async d=>{const result=await api(contentPath('/'+id+'/ai'),{method:'POST',body:{...d,version:item.version}});showForm('Review AI proposal',`<p class="note">${esc(result.notice)}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(result.result)}</pre>`,'Replace draft with proposal',async()=>{await api(contentPath('/'+id+'/ai/'+result.id+'/apply'),{method:'POST',body:{version:item.version}});await contentEditor(id);});});
  }

  async function loadCrm(){if(live.crmLoading)return;live.crmLoading=true;live.error="";render();try{if(!live.sites.length){const ws=await api(orgPath("")+"/websites");live.sites=ws.items;}live.crmSite=live.crmSite&&live.sites.find(s=>s._id===live.crmSite._id)||live.sites.find(s=>s.status==="active")||null;if(live.crmSite){const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";const [summary,leads,forms,members]=await Promise.all([api(p+"/summary"),api(p+"/leads"),api(p+"/capture-forms"),api(p+"/assignees")]);live.crmSummary=summary;live.crmLeads=leads.items;live.crmForms=forms.items;live.crmMembers=members.items;}live.crmLoaded=true;}catch(e){live.error=e.message;}finally{live.crmLoading=false;render();}}
  function pipelineContent(){
    const order=["new","contacted","qualified","meeting","proposal","won","lost"];
    const columns=order.map(stage=>{
      const leads=live.crmLeads.filter(lead=>lead.stage===stage);
      const cards=leads.map(lead=>'<article class="note"><b>'+esc(lead.name)+'</b><p>'+esc(lead.company||lead.email||lead.phone||"")+'</p><small>'+esc(lead.source)+' · score '+lead.score+'</small><div>'+button("Open lead","crm-view:"+lead._id)+'</div></article>').join("");
      return '<section class="card padded"><h3>'+esc(stage)+' <small>('+leads.length+')</small></h3>'+(cards||'<p class="helper">No leads</p>')+'</section>';
    }).join("");
    return '<section class="grid">'+columns+'</section>';
  }
  function crmContent(){const site=live.crmSite,tabs=["Inbox","Pipeline","Capture Forms","Reports"];const tabsHtml=tabs.map(t=>button(t,"crm-tab:"+t,live.crmTab===t)).join("");if(!live.crmLoaded){loadCrm();return header("Leads & CRM","Persisted leads, follow-ups and conversion activity.")+'<section class="card padded" role="status">Loading CRM records…</section>';}if(!site)return header("Leads & CRM","Connect an active website to manage its leads.")+'<section class="card padded"><h3>No active websites</h3><p class="helper">Add a website in Settings before using CRM.</p>'+button("Open Settings","settings",true)+'</section>';const path=orgPath("")+"/websites/"+site._id+"/crm";const mayWrite=["Owner","Admin","Marketing Manager","Sales User"].includes(live.org?.role);const rows=live.crmLeads.map(l=>'<tr><td><button class="link" data-live="crm-view:'+l._id+'">'+esc(l.name)+'</button><small>'+esc(l.email||l.phone||"")+'</small></td><td>'+esc(l.company||"—")+'</td><td>'+esc(l.stage)+'</td><td>'+esc(l.source)+'</td><td>'+l.score+'</td></tr>').join("");const focus=live.crmProfile?'<section class="card padded"><div class="actions"><h3>'+esc(live.crmProfile.lead.name)+'</h3>'+button("Close","crm-close")+'</div><p>'+esc(live.crmProfile.lead.email||live.crmProfile.lead.phone||"")+' · '+esc(live.crmProfile.lead.company||"")+' · '+esc(live.crmProfile.lead.stage)+' · Score '+live.crmProfile.lead.score+'</p><div class="actions">'+(mayWrite?button("Change stage","crm-stage:"+live.crmProfile.lead._id):"")+(mayWrite?button("Assign owner","crm-assign:"+live.crmProfile.lead._id):"")+(mayWrite?button("Add note","crm-note:"+live.crmProfile.lead._id):"")+(mayWrite?button("Log call","crm-log-call:"+live.crmProfile.lead._id):"")+(mayWrite?button("Log email","crm-log-email:"+live.crmProfile.lead._id):"")+(mayWrite?button("Log meeting","crm-log-meeting:"+live.crmProfile.lead._id):"")+(mayWrite?button("Schedule follow-up","crm-followup:"+live.crmProfile.lead._id):"")+(mayWrite&&live.crmProfile.lead.stage!=="won"?button("Convert","crm-convert:"+live.crmProfile.lead._id,true):"")+'</div><h4>Activity</h4>'+live.crmProfile.activities.map(a=>'<p class="helper"><b>'+esc(a.title)+'</b> · '+esc(a.type)+' · '+esc(a.createdAt||"")+'<br>'+esc(a.body||"")+'</p>').join("")+'</section>':'';const create=mayWrite?button("Add lead","crm-new",true):"";let body="";if(live.crmTab==="Capture Forms"){body=(mayWrite?button("Create capture form","crm-form-new",true):"")+'<section class="card padded">'+live.crmForms.map(f=>'<p><b>'+esc(f.name)+'</b> · '+(f.active?"Active":"Paused")+' · '+esc(f.publicId)+' '+(mayWrite?button(f.active?"Pause":"Activate","crm-form-toggle:"+f._id):"")+'</p>').join("")+(live.crmForms.length?"":"<p>No capture forms yet.</p>")+'</section>';}else if(live.crmTab==="Reports"){const s=live.crmSummary||{};body='<section class="grid">'+[['Total leads',s.total||0],['Won',s.won||0],['Overdue follow-ups',s.overdueFollowUps||0],['Upcoming follow-ups',s.upcomingFollowUps||0]].map(x=>'<article class="card padded"><small>'+x[0]+'</small><h2>'+x[1]+'</h2></article>').join("")+'</section><section class="card padded"><h3>Pipeline</h3><p>'+Object.entries(s.stages||{}).map(x=>esc(x[0])+": "+x[1]).join(" · ")+'</p><h3>Sources</h3><p>'+Object.entries(s.sources||{}).map(x=>esc(x[0])+": "+x[1]).join(" · ")+'</p></section>';}else if(live.crmTab==="Pipeline"){body=pipelineContent();}else{body=create+'<section class="card padded"><div class="table-wrap"><table><thead><tr><th>Lead</th><th>Company</th><th>Stage</th><th>Source</th><th>Score</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(rows?"":"<p>No leads have been captured for this website.</p>")+'</section>';}return header("Leads & CRM",site.name+" · "+site.domain+" · Persisted workspace records only.")+errorBox(live.error)+'<section class="card padded"><div class="actions">'+live.sites.map(s=>button(s.name+" · "+s.domain,"crm-site:"+s._id,s._id===site._id)).join("")+'</div><div class="actions">'+tabsHtml+button("Refresh","crm-refresh")+'</div></section>'+focus+body;}


  const m9={tab:"summary",site:null,orgId:null,loaded:false,loading:false,error:"",data:{},policy:null,proposals:[],rangeDays:30};
  function m9Path(suffix=""){return orgPath("")+"/websites/"+m9.site._id+suffix;}
  async function loadM9(){if(m9.loading)return;m9.loading=true;m9.error="";render();try{if(m9.orgId!==live.org?._id){m9.site=null;m9.data={};m9.policy=null;m9.proposals=[];m9.orgId=live.org?._id;}if(!live.sites?.length){const w=await api(orgPath("")+"/websites");live.sites=w.items;}m9.site=m9.site&&live.sites.find(s=>s._id===m9.site._id)||live.sites.find(s=>s.status==="active")||null;if(m9.site){const base=m9Path("/analytics");if(m9.tab==="agents"){const [policy,proposals,inbox,runs]=await Promise.all([api(m9Path("/ai-policy")),api(m9Path("/decisions")),api(m9Path("/inbox")),api(m9Path("/agent-runs"))]);m9.policy=policy;m9.proposals=proposals.items;m9.inbox=inbox.items;m9.runs=runs.items;}else if(m9.tab==="reports"){const reports=await api(base+"/reports");m9.data={reports:reports.items};}else{const qs="?from="+encodeURIComponent(new Date(Date.now()-(m9.rangeDays||30)*86400000).toISOString())+"&to="+encodeURIComponent(new Date().toISOString());const tasks=[api(base+"/overview"+qs),api(base+"/providers"),api(base+"/acquisition"+qs),api(base+"/content"+qs),api(base+"/seo"+qs),api(base+"/attribution"+qs),api(base+"/leads"+qs)];if(["Owner","Admin"].includes(live.org?.role))tasks.push(api(base+"/revenue"+qs));const r=await Promise.all(tasks);m9.data={overview:r[0],providers:r[1],acquisition:r[2],content:r[3],seo:r[4],attribution:r[5],leads:r[6],revenue:r[7]||null};}}m9.loaded=true;}catch(e){m9.error=e.message;m9.loaded=true;}finally{m9.loading=false;render();}}
  const m9Val=(v)=>v===null||v===undefined?"Unavailable":Number(v).toLocaleString();
  function analyticsContent(){if(!m9.loaded){loadM9();return header("Analytics & Reports","Verified business outcomes, with provider coverage shown explicitly.")+'<section class="card padded" role="status">Loading real workspace records…</section>';}const tabs=[["summary","Overview"],["acquisition","Acquisition"],["content","Content"],["seo","SEO"],["attribution","Attribution"],["reports","Reports"],["agents","Assisted agents"]];const nav=tabs.map(([k,n])=>button(n,"m9-tab:"+k,m9.tab===k)).join("");if(!m9.site)return header("Analytics & Reports","Choose an active website to inspect its real records.")+'<section class="card padded"><h3>No active website</h3><p class="helper">Add an active website in Settings to view scoped analytics.</p>'+button("Open Settings","settings",true)+'</section>';const providers=m9.data.providers?.items||[];const providerCards=providers.map(p=>'<div class="card padded"><small>'+esc(p.provider.replaceAll("_"," "))+'</small><h3>'+esc(p.status.replaceAll("_"," "))+'</h3><p class="helper">'+(p.observedAt?"Last verified sync "+esc(new Date(p.observedAt).toLocaleString()):"No verified measurements")+'</p></div>').join("");let body="";if(m9.tab==="summary"){const x=m9.data.overview||{},crm=x.crm||{};body='<section class="grid"><div class="card padded"><small>Leads · created cohort</small><h2>'+m9Val(crm.leads)+'</h2></div><div class="card padded"><small>Qualified · current stage</small><h2>'+m9Val(crm.qualified)+'</h2></div><div class="card padded"><small>Won · current stage</small><h2>'+m9Val(crm.won)+'</h2></div><div class="card padded"><small>Won value · '+esc(live.org?.currency||"")+'</small><h2>'+m9Val(crm.wonValueMinor===null?null:(crm.wonValueMinor/100).toFixed(2))+'</h2><p class="helper">Coverage '+(crm.valueCoverage?.covered??0)+' of '+(crm.valueCoverage?.total??0)+' won leads</p></div><div class="card padded"><small>Sessions · GA4</small><h2>Unavailable</h2><p class="helper">Provider data is never replaced with a synthetic value.</p></div></section><h3>Provider coverage</h3><section class="grid">'+providerCards+'</section><p class="helper">'+esc(crm.basis||"")+'</p>';}else if(m9.tab==="acquisition"){const rows=m9.data.acquisition?.items||[];body='<div class="table-scroll"><table><thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Sessions</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.source||"unknown")+'</td><td>'+x.leads+'</td><td>'+x.won+'</td><td>Unavailable</td></tr>').join("")+'</tbody></table></div><p class="helper">Lead counts come from real CRM records. Sessions require GA4.</p>';}else if(m9.tab==="content"){const rows=m9.data.content?.items||[];body='<div class="table-scroll"><table><thead><tr><th>Page</th><th>Type</th><th>Leads</th><th>Views</th><th>Assisted value</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.page||"—")+'</td><td>'+esc(x.type||"—")+'</td><td>'+x.leads+'</td><td>Unavailable</td><td>'+m9Val(x.assistedValueMinor===null?null:(x.assistedValueMinor/100).toFixed(2))+'</td></tr>').join("")+'</tbody></table></div>'+(rows.length?"":'<p class="helper">No published pages are available for this website.</p>');}else if(m9.tab==="seo"){const s=m9.data.seo||{};body='<section class="card padded"><div class="actions">'+badge(s.status||"unavailable")+'</div><h3>Search performance</h3><p class="helper">'+esc(s.reason||"Verified Search Console measurements are not available.")+'</p><dl class="knowledge"><div><dt>Clicks</dt><dd>Unavailable</dd></div><div><dt>Impressions</dt><dd>Unavailable</dd></div><div><dt>CTR</dt><dd>Unavailable</dd></div><div><dt>Position</dt><dd>Unavailable</dd></div></dl></section>';}else if(m9.tab==="attribution"){const rows=m9.data.attribution?.items||[];body='<div class="table-scroll"><table><thead><tr><th>Source</th><th>Campaign</th><th>Leads</th><th>Credited value</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.source)+'</td><td>'+esc(x.campaign)+'</td><td>'+x.leads+'</td><td>'+m9Val(x.creditedValueMinor===null?null:(x.creditedValueMinor/100).toFixed(2))+'</td></tr>').join("")+'</tbody></table></div><p class="helper">'+esc(m9.data.attribution?.coverage||"No CRM attribution records in this period.")+'</p>';}else if(m9.tab==="reports"){const reports=m9.data.reports||[];body='<section class="card padded"><p class="helper">Generate reports from real CRM records. Provider metrics stay unavailable until verified sync is present.</p>'+button("Create report","m9-report-create",true)+'</section><section class="grid">'+(reports.map(r=>'<article class="card padded"><h3>'+esc(r.name)+'</h3><p class="helper">'+esc(r.status)+' · '+new Date(r.createdAt).toLocaleString()+'</p><p class="helper">'+esc((r.sections||[]).join(", "))+'</p><div class="actions">'+(r.status==="ready"?button("View report","m9-report-view:"+r._id):button("Generate report","m9-report-generate:"+r._id,true))+(r.status==="ready"?'<a class="btn" href="/api/v1'+m9Path("/analytics/reports/"+r._id+"/download")+'">Download</a>':"")+'</div></article>').join("")||'<p class="helper">No reports created for this website.</p>')+'</section>';}else{const p=m9.policy?.policy;const canConfigure=["Owner","Admin"].includes(live.org?.role),canPropose=["Owner","Admin","Marketing Manager","SEO Manager"].includes(live.org?.role);body='<section class="card padded"><div class="actions">'+badge(p?.mode||"manual")+' '+badge(m9.policy?.source||"workspace")+'</div><p class="helper">Policy version '+(p?.version??0)+' · max spend '+m9Val(p?.maxSpendMinor??0)+' minor units · page limit '+(p?.maxPages??0)+'</p><p class="helper">Allowed actions: '+esc((p?.allowedActions||[]).join(", ")||"none")+'</p><div class="actions">'+(canConfigure?(p?.mode==="assisted"?button("Set Manual mode","m9-policy-manual"):button("Enable Assisted content drafts","m9-policy-assisted",true)):"")+(canPropose&&p?.mode==="assisted"&&(p.allowedActions||[]).includes("content_draft")?button("Propose content draft","agent-propose",true):"")+'</div></section><h3>Decision history</h3><section class="grid">'+((m9.proposals||[]).map(x=>'<article class="card padded"><div class="actions">'+badge(x.status)+' '+badge(x.action.replaceAll("_"," "))+'</div><p>'+esc(x.rationale)+'</p><p class="helper">'+esc(x.impact)+'</p><p class="helper">Input hash '+esc(x.inputHash.slice(0,16))+'… · '+new Date(x.createdAt).toLocaleString()+'</p>'+(["Owner","Admin","Marketing Manager"].includes(live.org?.role)&&x.status==="proposed"&&String(x.createdBy)!==String(live.user?._id)?button("Approve proposal","agent-approve:"+x._id,true):"")+'</article>').join("")||'<p class="helper">No assisted proposals have been recorded.</p>')+'</section><h3>Growth inbox</h3><section class="grid">'+((m9.inbox||[]).map(x=>'<article class="card padded"><div class="actions">'+badge(x.priority)+' '+badge(x.status)+'</div><h3>'+esc(x.title)+'</h3><p>'+esc(x.leadName||"Lead follow-up")+'</p><p class="helper">Due '+(x.dueAt?new Date(x.dueAt).toLocaleString():"date unavailable")+'</p><div class="actions">'+button("Acknowledge","m9-inbox-ack:"+x.activityId)+button("Snooze 1 day","m9-inbox-snooze:"+x.activityId)+'</div></article>').join("")||'<p class="helper">No overdue CRM follow-ups.</p>')+'</section><h3>AI Activity</h3><section class="grid">'+((m9.runs||[]).map(x=>'<article class="card padded"><div class="actions">'+badge(x.status)+' '+badge(x.agent.replaceAll("_"," "))+'</div><p>'+esc(x.operation||"Agent run")+' · '+new Date(x.startedAt).toLocaleString()+'</p><p class="helper">'+(x.costMinor===null?"Cost unavailable":m9Val(x.costMinor))+' · '+(x.finishedAt?"Finished "+new Date(x.finishedAt).toLocaleString():"In progress")+'</p>'+(x.retryable?button("Retry failed run","agent-retry:"+x.runId,true):"")+'</article>').join("")||'<p class="helper">No AI runs have been recorded for this website.</p>')+'</section>';}return header("Analytics & Reports","Real CRM records and provider coverage for "+esc(m9.site.name)+".")+'<section class="card padded"><div class="actions">'+live.sites.filter(s=>s.status==="active").map(s=>button(s.name+" · "+s.domain,"m9-site:"+s._id,s._id===m9.site._id)).join("")+'</div><div class="actions">'+nav+button("Last "+m9.rangeDays+" days","m9-period")+button("Refresh","m9-refresh")+'</div></section>'+errorBox(m9.error)+body;}

  function liveContent() {
    if (live.loading)
      return (
        header("Your workspace", "Loading your saved workspace…") +
        '<section class="card padded" role="status"><div class="skeleton-bar"></div><div class="skeleton-bar"></div><p class="helper">Loading…</p></section>'
      );
    if (!cfg.apiEnabled)
      return (
        header(
          "Your workspace",
          "Your real account and business data belong here.",
        ) +
        `<section class="card padded"><h3>Workspace service awaiting connection</h3><p class="helper">The foundation is ready for backend deployment. Account creation and real records will become available once the service is connected.</p>${button("Return to design preview", "demo")}${button("View build plan", "build-plan")}</section>`
      );
    if (!live.user)
      return (
        header(
          "Your workspace",
          "Sign in to manage your organizations, team, and websites.",
        ) +
        errorBox(live.error) +
        `<section class="card padded"><h3>Welcome to AI Growth OS</h3><p class="helper">Create an account to start with an empty, private workspace.</p><div class="actions">${button("Sign in", "sign-in", true)}${button("Create account", "sign-up")}${button("Try again", "retry")}</div></section>`
      );
    if (live.tab === "Account") return accountContent();
    if (!live.user.emailVerifiedAt)
      return header("Verify your email", "Protect your account before opening a workspace.") + errorBox(live.error) +
        `<section class="card padded"><h3>Check your inbox</h3><p class="helper">Send a verification link to ${esc(live.user.email)}. Your workspace stays private until your email is verified.</p><div class="actions">${button("Send verification email", "send-verification", true)}${button("I have verified my email", "retry")}${button("Account & security", "account")}${button("Sign out", "sign-out")}</div></section>`;
    if (!live.org)
      return (
        header(
          "Let’s create your workspace.",
          "A home for your team and websites.",
        ) +
        errorBox(live.error) +
        `<section class="card padded"><h3>Welcome, ${esc(live.user.name)}</h3><p class="helper">You do not belong to a workspace yet.</p><div class="actions">${button("Create workspace", "create-org", true)}${button("Accept invitation", "accept-invite")}</div></section>`
      );
    if (state.page === "content") return contentPanel();
    if (state.page === "leads") return crmContent();
    if (state.page === "analytics") return analyticsContent();
    if (state.page === "seo") return seoContent();
    if (knowledgePage()) return knowledgeContent();
    if (state.page !== "settings")
      return (
        header(
          modules.find((m) => m[0] === state.page)[1],
          "This module will be connected in its roadmap milestone.",
        ) +
        `<section class="card padded"><h3>Your workspace is ready for its foundation.</h3><p class="helper">Manage your organization, team, and websites in Settings. This module has no live records yet.</p><div class="actions">${button("Open workspace settings", "settings", true)}${button("Explore approved design", "demo")}</div></section>`
      );
    const available = [
      "Organization",
      "Websites",
      "Account",
      ...(isManager() ? ["Team & roles", "Audit logs"] : []),
      ...(live.crawlSite ? ["Crawls", "URL Inventory", "Crawl issues"] : []),
    ];
    if (!available.includes(live.tab)) live.tab = "Organization";
    let body = "";
    if (live.tab === "Organization")
      body = `<section class="card padded"><h3>${esc(live.org.name)}</h3><div class="knowledge"><span>Timezone</span><strong>${esc(live.org.timezone)}</strong></div><div class="knowledge"><span>Currency</span><strong>${esc(live.org.currency)}</strong></div><div class="knowledge"><span>Your role</span>${badge(live.org.role)}</div><div class="actions" style="margin-top:24px">${isManager() ? button("Edit preferences", "edit-org", true) : ""}${button("Switch workspace", "workspaces")}${button("Accept invitation", "accept-invite")}</div></section>`;
    if (live.tab === "Websites")
      body = `<section class="card"><div class="card-head"><div><h2>Your websites</h2><p>Verify ownership before starting a crawl.</p></div>${isManager() ? button("Add website", "add-site", true) : ""}</div>${live.sites.length ? `<div class="table-scroll"><table><thead><tr><th>Website</th><th>CMS</th><th>Ownership</th><th>Status</th><th>Actions</th></tr></thead><tbody>${live.sites.map((s) => `<tr><td>${esc(s.name)}<small>${esc(s.domain)}</small></td><td>${esc(s.cmsType)}</td><td>${badge(s.verificationStatus)}</td><td>${badge(s.status)}</td><td><div class="actions">${button("View", "view-site:" + s._id)}${button("Crawls", "open-crawls:" + s._id)+button("SEO overview", "seo-overview:" + s._id)}${isManager() ? button("Edit", "edit-site:" + s._id) + (s.status === "active" ? button("Verify", "verify-site:" + s._id) : "") : ""}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>No websites yet</strong>Add your first domain to start your website setup.</div>'}${live.cursor ? button("Load more", "more") : ""}</section>`;
    if (live.tab === "Team & roles")
      body = `<section class="card padded"><div class="card-head" style="padding:0 0 20px"><h2>Your team</h2>${button("Invite member", "invite", true)}</div>${live.members.map((m) => `<div class="knowledge"><div><strong>${esc(m.user?.name || "Member")}</strong><small>${esc(m.user?.email || "")}</small></div>${badge(m.role)}<div class="actions">${m.role !== "Owner" && (live.org.role === "Owner" || m.role !== "Admin") ? button("Manage", "member:" + m._id) : ""}</div></div>`).join("")}<h3 style="margin-top:28px">Pending invitations</h3>${live.invites.length ? live.invites.map((i) => `<div class="knowledge"><div><strong>${esc(i.email)}</strong><small>${esc(i.role)} · Expires ${new Date(i.expiresAt).toLocaleDateString()}</small></div>${live.org.role === "Owner" || i.role !== "Admin" ? button("Revoke", "revoke:" + i._id) : ""}</div>`).join("") : '<p class="helper">No pending invitations.</p>'}<p class="helper">Invitations use a private link you share yourself. No email is sent automatically.</p></section>`;
    if (["Crawls", "URL Inventory", "Crawl issues"].includes(live.tab)) body = crawlerPanel();
    if (live.tab === "Audit logs")
      body = `<section class="card"><div class="card-head"><div><h2>Workspace activity</h2><p>${Object.keys(live.auditFilters).length ? "Filtered workspace records" : "Saved server records"}</p></div><div class="actions">${button("Filter", "audit-filter")}${Object.keys(live.auditFilters).length ? button("Clear filters", "audit-clear") : ""}${button("Export JSON", "audit-export")}</div></div>${live.audit.length ? `<div class="table-scroll"><table><thead><tr><th>Action</th><th>Record</th><th>Actor</th><th>Time</th></tr></thead><tbody>${live.audit.map((a) => `<tr><td><button class="text-btn" data-live="audit:${a._id}">${esc(a.action)}</button></td><td>${esc(a.entityType)}</td><td>${esc(a.actorId)}</td><td>${esc(new Date(a.occurredAt).toLocaleString("en-IN", { timeZone: live.org.timezone }))}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No activity matches these filters.</div>'}${live.cursor ? button("Load more", "more") : ""}</section>`;
    return (
      header(
        "A workspace that works your way.",
        "Manage your organization, team, and websites.",
      ) +
      `<div class="tabs">${available.map((t) => `<button data-live="tab:${t}" class="${live.tab === t ? "active" : ""}">${t}</button>`).join("")}</div>` +
      errorBox(live.error) +
      (live.error ? button("Retry", "retry") : "") +
      body
    );
  }

  async function loadSeo(force=false) {
    if (live.seoLoading || (live.seoLoaded && !force)) return;
    live.seoLoading=true;live.error="";render();const generation=live.generation,orgId=live.org&&live.org._id;
    try {
      const sites=await api(orgPath("/websites"));
      if(generation!==live.generation||orgId!== (live.org&&live.org._id))return;
      live.sites=sites.items;
      const site=(live.seoSite&&sites.items.find(s=>s._id===live.seoSite._id&&s.status==="active"))||sites.items.find(s=>s.status==="active");
      live.seoSite=site||null;live.seoLoaded=true;
      if(!site){live.seoSummary=null;live.seoProviders=[];live.seoDrafts=[];live.seoTargets=[];live.seoTargetStatus=null;live.seoJobs=[];return;}
      live.crawlSite=site;const path=orgPath("/websites/"+site._id+"/seo");
      const result=await Promise.all([api(path+"/summary"),api(path+"/providers"),api(path+"/schema"),api(path+"/publish-targets"),api(orgPath("/cms/jobs"))]);
      if(generation!==live.generation||orgId!==(live.org&&live.org._id)||(live.seoSite&&live.seoSite._id)!==site._id)return;
      live.seoSummary=result[0];live.seoProviders=result[1].items;live.seoDrafts=result[2].items;live.seoTargets=result[3].items;live.seoTargetStatus=result[3];live.seoJobs=(result[4].items||[]).filter(j=>j.operation==="schema");
    } catch(e){if(generation===live.generation)live.error=e.message;}
    finally{if(generation===live.generation){live.seoLoading=false;render();}}
  }
  function seoContent() {
    if(!live.seoLoaded){loadSeo();return header("SEO & AI Visibility","Real crawl evidence and provider-backed observations only.")+'<section class="card padded" role="status">Loading SEO workspace…</section>';}
    const site=live.seoSite;
    if(!site)return header("SEO & AI Visibility","Connect your website to review its SEO evidence.")+errorBox(live.error)+'<section class="card padded"><h3>No active websites</h3><p class="helper">Add an active website in Settings before opening its SEO workspace.</p>'+button("Open website settings","settings",true)+'</section>';
    const summary=live.seoSummary||{};
    const tabs=["Overview","Issues","Providers","Schema","AI Visibility"];
    const siteChooser=live.sites.map(s=>button(s.name+" · "+s.domain,"seo-site:"+s._id,site._id===s._id)).join("");
    const tabButtons=tabs.map(t=>button(t,"seo-tab:"+t,live.seoTab===t)).join("");
    let body="";
    if(live.seoTab==="Overview"){
      body='<section class="card padded"><div class="card-head"><div><h2>'+esc(site.name)+'</h2><p>'+esc(site.domain)+'</p></div>'+button("Refresh evidence","seo-reload")+'</div>';
      if(summary.crawl){
        body+='<div class="knowledge"><strong>Latest crawl</strong><span>'+badge(summary.crawl.status)+' · '+esc(summary.crawl.completedAt||"")+'</span></div>';
        body+='<div class="knowledge"><span>Audited pages</span><strong>'+summary.auditedPages+'</strong></div>';
        body+='<div class="knowledge"><span>Indexable / not indexable / unknown</span><strong>'+summary.indexable+' / '+summary.notIndexable+' / '+summary.unknown+'</strong></div>';
        if(summary.crawl.truncated)body+='<p class="note">This crawl was limited. Counts describe only the recorded crawl coverage.</p>';
        body+='<h3>Technical issues</h3>';
        body+=summary.issues&&summary.issues.length?summary.issues.map(i=>'<div class="knowledge">'+badge(i.severity)+'<strong>'+esc(i.type)+'</strong><span>'+i.count+'</span><p class="helper">'+esc(i.recommendation||"")+'</p></div>').join(""):'<p class="helper">No issue evidence was recorded for this crawl.</p>';
      }else body+='<div class="empty">No completed crawl evidence for this website yet. Start a crawl from Settings → Crawls.</div>';
      body+='<p class="helper">Search Console, rankings and AI visibility remain unavailable until verified provider authorization and sync are configured. No sample metrics are shown.</p></section>';
    }
    if(live.seoTab==="Issues")body='<section class="card padded"><h2>Technical issue workflows</h2><p class="helper">Issue evidence and triage are available in the selected crawl report. Rechecks require a newer completed crawl.</p>'+(summary.crawl?button("Open latest crawl issues","open-seo-issues"):'<div class="empty">Complete a crawl to create issue evidence.</div>')+'</section>';
    if(live.seoTab==="Providers")body='<section class="card"><div class="card-head"><div><h2>Provider connections</h2><p>Connection requests never imply live data. Verified authorization is required before syncing.</p></div>'+button("Refresh status","seo-reload")+'</div><div class="padded">'+live.seoProviders.map(p=>'<div class="knowledge"><div><strong>'+esc(p.label)+'</strong><small>'+esc(p.data)+'</small><small>'+esc(p.connection)+'</small></div>'+badge(p.status)+(p.property?'<small>'+esc(p.property)+'</small>':"")+'<div class="actions">'+(canCrawl()?(p.status==="disconnected"?button("Request connection","seo-connect:"+p.key):button("Disconnect","seo-disconnect:"+p.key)):"")+'</div><p class="helper">'+(p.metricsAvailable?"Provider records can be shown after a verified sync.":"No provider data is available in this state.")+'</p></div>').join("")+'</div></section>';
    if(live.seoTab==="Schema")body='<section class="card"><div class="card-head"><div><h2>Structured data drafts</h2><p>Strictly validated JSON-LD. Approval is independent from authoring; publishing must use the connected CMS workflow.</p></div>'+(canCrawl()?button("New schema draft","seo-schema-new",true):"")+'</div><div class="padded">'+(live.seoDrafts.length?live.seoDrafts.map(d=>'<div class="knowledge"><div><strong>'+esc(d.name)+'</strong><small>'+esc(d.url)+'</small><small>'+esc(d.jsonLd["@type"])+'</small></div>'+badge(d.status)+'<div class="actions">'+(canCrawl()&&d.status==="draft"?button("Submit for review","seo-schema-transition:"+d._id+":review"):"")+(["Owner","Admin","Marketing Manager"].includes(live.org&&live.org.role)&&d.status==="review"?button("Approve","seo-schema-transition:"+d._id+":approve"):"")+(["Owner","Admin","Marketing Manager"].includes(live.org&&live.org.role)&&d.status==="approved"?button("Publish to WordPress","seo-schema-publish:"+d._id):"")+(canCrawl()&&d.status!=="archived"&&d.status!=="publishing"?button("Archive","seo-schema-transition:"+d._id+":archive"):"")+'</div></div>').join(""):'<div class="empty">No schema drafts saved for this website.</div>')+(live.seoTargetStatus&&!live.seoTargetStatus.available?'<p class="note">'+esc(live.seoTargetStatus.reason||"WordPress schema publication is not configured.")+'</p>':'')+(live.seoJobs.length?'<h3>Schema publication jobs</h3>'+live.seoJobs.map(j=>'<div class="knowledge"><strong>'+esc(j.schemaId||"Schema")+'</strong>'+badge(j.status)+'<small>'+esc(j.error||"")+'</small>'+(j.status==="needs_review"?button("Reconcile outcome","seo-schema-reconcile:"+j._id):"")+(j.status==="queued"?button("Cancel","seo-schema-cancel:"+j._id):"")+'</div>').join(""):'')+'</div></section>';
    if(live.seoTab==="AI Visibility")body='<section class="card padded"><h2>AI visibility observations</h2><p class="helper">No provider is connected, so no citation or visibility metrics are available. Connect a supported provider before recording observations.</p>'+button("Review providers","seo-tab:Providers")+'</section>';
    return header("SEO & AI Visibility","A unified view of crawl evidence, issue triage, provider status and reviewed schema.")+errorBox(live.error)+'<div class="tabs">'+siteChooser+'</div><div class="tabs">'+tabButtons+'</div>'+body;
  }

  function crawlerPanel() {
    const site = live.crawlSite;
    const heading = `<div class="card-head"><div><h2>${esc(site.name)}</h2><p>${esc(site.domain)}</p></div><div class="actions">${button("Websites", "tab:Websites")}${canCrawl() ? button("Start crawl", "start-crawl", true) : ""}</div></div>`;
    if (live.tab === "Crawls") {
      const summary = live.crawlSummary;
      return `<section class="card">${heading}<div class="padded"><p class="helper">${summary ? `${summary.total} stored URLs · ${summary.indexable} indexable · ${summary.notIndexable} not indexable` : "No completed crawl yet."}</p>${site.verificationStatus !== "verified" ? '<p class="note">Verify website ownership before starting a crawl.</p>' : ""}</div>${live.crawls.length ? `<div class="table-scroll"><table><thead><tr><th>Crawl / status</th><th>Progress</th><th>Started / completed</th><th>Duration</th><th>Errors</th><th>Actions</th></tr></thead><tbody>${live.crawls.map(j => `<tr><td><small>${esc(j._id)}</small>${badge(j.status)}${j.error ? `<small>${esc(j.error)}</small>` : ""}</td><td><progress max="100" value="${j.progress || 0}" aria-label="Crawl progress"></progress><small>${j.progress || 0}% · ${j.crawled || 0}/${j.discovered || 0} pages</small><small>${j.successCount || 0} successful · ${j.redirectCount || 0} redirects</small>${j.lastUrl ? `<small>${esc(j.lastUrl)}</small>` : ""}${j.truncated ? '<small>Configured crawl limit reached</small>' : ""}</td><td><small>${esc(j.startedAt || "Queued")}</small><small>${esc(j.completedAt || "—")}</small></td><td>${Math.round((j.durationMs || (j.startedAt ? Date.now()-Date.parse(j.startedAt) : 0))/1000)}s</td><td>${j.errorCount || 0}</td><td><div class="actions">${button("Report", "crawl-report:" + j._id)}${canCrawl() ? (["queued","running"].includes(j.status) ? button("Cancel", "cancel-crawl:" + j._id) : button("Re-run", "rerun-crawl:" + j._id) + (["failed","completed_with_errors","cancelled"].includes(j.status) ? button("Retry", "retry-crawl:" + j._id) : "")) : ""}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>No crawls yet</strong>Start a crawl of your verified website to discover its pages.</div>'}${live.cursor ? button("More crawls", "more-crawls") : ""}</section>`;
    }
    if (live.tab === "URL Inventory") return `<section class="card">${heading}<div class="card-head"><span>${live.urlTotal} matching URLs</span><div class="actions">${button("Filter URLs", "url-filter")}${button("Clear filters", "url-clear")}</div></div>${live.urlItems.length ? `<div class="table-scroll"><table><thead><tr><th>URL / title</th><th>Status</th><th>Indexability</th><th>Canonical</th><th>Content type</th><th>Sitemap</th><th>Incoming links</th><th>Last crawled</th></tr></thead><tbody>${live.urlItems.map(p => `<tr><td><button class="text-btn" data-live="url-detail:${p._id}">${esc(p.url)}</button><small>${esc(p.data?.title || "No title")}</small></td><td>${badge(String(p.data?.statusCode || p.status))}<small>${p.issues.length} issues</small></td><td>${badge(p.data?.indexable ? "Indexable" : "Not indexable")}</td><td>${esc(p.data?.canonical || "—")}</td><td>${esc(p.data?.contentType || "—")}</td><td>${p.inSitemap ? "Yes" : "No"}</td><td>${p.incomingLinks || 0}</td><td>${esc(p.data?.crawledAt || "—")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No matching URLs. Complete a crawl or adjust the filters.</div>'}<div class="card-head"><span>Page ${live.urlPage}</span><div class="actions">${live.urlPage > 1 ? button("Previous", "urls-prev") : ""}${live.urlPage*25 < live.urlTotal ? button("Next", "urls-next") : ""}</div></div></section>`;
    const report = live.crawlReport;
    return `<section class="card">${heading}<div class="padded">${!report ? '<div class="empty">Open a crawl report from the Crawls tab.</div>' : `<h3>Technical issues</h3>${button("Filter issue workflows", "seo-list")}<p class="helper">Issues reflect this crawl's coverage. Orphan and duplicate content findings are candidates for review.</p>${report.issues.items.length ? report.issues.items.map(i => `<div class="knowledge"><div>${badge(i.severity)}<strong>${esc(i.type.replaceAll("_"," "))}</strong><small>${esc(i.url)}</small><p>${esc(i.why)}</p><p class="helper">${esc(i.recommendation)}</p>${button("Issue workflow", "seo-issue:"+i._id)}</div></div>`).join("") : '<p class="helper">No issues recorded for this crawl.</p>'}${report.issues.nextCursor ? button("More issues", "more-issues") : ""}<h3>Robots.txt</h3>${report.robots.items.map(r => `<p>${badge(r.status)} ${esc(r.url)}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.body || r.error || "No robots rules found")}</pre>`).join("") || '<p class="helper">Robots information is not available yet.</p>'}<h3>Sitemaps</h3>${report.sitemaps.items.map(m => `<details><summary>${esc(m.url)} · ${esc(m.status)} · ${m.urls?.length || 0} URLs</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(m.urls || m.error, null, 2))}</pre></details>`).join("") || '<p class="helper">No sitemaps recorded.</p>'}<h3>Crawl errors</h3>${report.errors.items.map(e => `<p>${esc(e.url)} — ${esc(e.code)}</p>`).join("") || '<p class="helper">No crawl errors recorded.</p>'}${report.errors.nextCursor ? button("More errors", "more-crawl-errors") : ""}`}</div></section>`;
  }
  async function showSeoIssues(){
    const params=new URLSearchParams({...live.seoFilter,page:String(live.seoPage)});
    const result=await api(crawlPath('/seo/issues?'+params));
    modal('Issue workflows', `<p>${result.total} matching issues · page ${result.page}</p>${result.items.length?`<div class="table-scroll"><table><thead><tr><th>URL / issue</th><th>Severity</th><th>Status</th><th>Action</th></tr></thead><tbody>${result.items.map(i=>`<tr><td>${esc(i.url)}<small>${esc(i.type)}</small></td><td>${badge(i.severity)}</td><td>${badge(i.workflow.status)}</td><td>${button('View','seo-issue:'+i._id)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No issues match these filters.</div>'}<div class="actions">${button('Filters','seo-list')}${result.page>1?button('Previous','seo-back'):''}${result.page*result.limit<result.total?button('Next','seo-more'):''}</div>`);bindLive();
  }
  const crawlPath = suffix => orgPath("/websites/" + live.crawlSite._id + suffix);
  settings = function () {
    return live.active
      ? liveContent()
      : `<div class="foundation-banner"><div><strong>Your next step: a real workspace</strong><p>Organizations, team access, and website setup.</p></div>${button("Open workspace", "live", true)}</div>` +
          originalSettings();
  };
  render = function () {
    originalRender();
    if(live.active && state.page==="leads"){document.querySelector(".page").innerHTML=crmContent();}
    const top = document.querySelector(".top-right");
    if (top) {
      const existing = top.querySelector(".demo");
      if (existing)
        existing.textContent = live.active
          ? "Workspace"
          : "Design preview · sample data";
      top.insertAdjacentHTML(
        "afterbegin",
        button(
          live.active ? "Design preview" : "Open workspace",
          live.active ? "demo" : "live",
        ),
      );
    }
    if (live.active) {
      document.querySelector(".page").innerHTML = liveContent();
      document.querySelector(".footer-note").innerHTML =
        "<span>Workspace foundation</span><span>Real records only · No demo metrics</span>";
      const w = document.querySelector(".workspace");
      w.querySelector("strong").textContent =
        live.org?.name || "Your workspace";
      w.querySelector("small").textContent =
        live.org?.role || "Sign in to begin";
      document.querySelector(".plan").innerHTML =
        "<strong>Workspace foundation</strong><p>Organization · Team · Websites</p>";
      document.querySelector(".profile").innerHTML =
        `<span class="avatar">${esc(live.user?.name?.slice(0, 2).toUpperCase() || "YO")}</span><span><b>${esc(live.user?.name || "Your account")}</b><small>${esc(live.org?.role || "Not signed in")}</small></span>`;
      document.querySelector(".profile").onclick = () => run("account");
      document.querySelectorAll(".nav .count").forEach((e) => e.remove());
      document.querySelector(".search-global").style.display = "none";
      document.querySelector(".notification").style.display = "none";
      document.querySelector('.page [data-action="export"]')?.remove();
    }
    bindLive();
  };
  action = function (a) {
    if (live.active) {
      if (a === "workspace") {
        workspacePicker();
        return;
      }
      if(a.startsWith("crm-")||a.startsWith("m9-")||a.startsWith("agent-")){run(a);return;}
      if (a === "menu" || a === "close") return originalAction(a);
      if (a === "help") return run("build-plan");
      return;
    }
    return originalAction(a);
  };
  async function run(a) {
    const [key, id] = a.split(":");
    try {
      if(key==="m9-report-create"){showForm("Create analytics report",input("Report name","name"),"Create report",async v=>{const now=new Date();await api(m9Path("/analytics/reports"),{method:"POST",body:{name:v.name,sections:["overview","leads","acquisition"],from:new Date(now.getTime()-30*86400000).toISOString(),to:now.toISOString(),format:"json"}});closeModal();m9.loaded=false;await loadM9();});return;}if(key==="m9-report-generate"){const report=(m9.data.reports||[]).find(x=>x._id===id);if(!report)return;await api(m9Path("/analytics/reports/"+id+"/generate"),{method:"POST",body:{version:report.version}});m9.loaded=false;await loadM9();return;}if(key==="m9-report-view"){const report=await api(m9Path("/analytics/reports/"+id));modal("Analytics report",'<pre class="code-block">'+esc(JSON.stringify(report.snapshot,null,2))+'</pre>');bindLive();return;}if(key==="m9-period"){m9.rangeDays=m9.rangeDays===7?30:m9.rangeDays===30?90:7;m9.loaded=false;await loadM9();return;}if(key==="m9-refresh"){m9.loaded=false;await loadM9();return;}if(key==="m9-tab"){m9.tab=id;m9.loaded=false;await loadM9();return;}if(key==="m9-site"){m9.site=live.sites.find(s=>s._id===id)||null;m9.loaded=false;await loadM9();return;}if(key==="m9-policy-assisted"||key==="m9-policy-manual"){const old=m9.policy?.policy||{};await api(m9Path("/ai-policy"),{method:"PUT",body:{version:old.version||0,mode:key==="m9-policy-assisted"?"assisted":"manual",allowedActions:key==="m9-policy-assisted"?["content_draft"]:(old.allowedActions||[]),maxSpendMinor:old.maxSpendMinor||0,maxPages:key==="m9-policy-assisted"?Math.max(old.maxPages||0,1):(old.maxPages||0),protectedUrls:old.protectedUrls||[]}});m9.loaded=false;await loadM9();return;}if(key==="agent-propose"){showForm("Propose a content draft",input("Target URL","url")+input("Rationale","rationale")+input("Expected impact","impact"),"Submit for review",async v=>{await api(m9Path("/decisions"),{method:"POST",body:{action:"content_draft",input:{url:v.url},rationale:v.rationale,impact:v.impact,costMinor:0}});closeModal();m9.loaded=false;await loadM9();});return;}if(key==="m9-inbox-ack"||key==="m9-inbox-snooze"){const item=(m9.inbox||[]).find(x=>String(x.activityId)===id);if(!item)return;const body={version:item.version,action:key==="m9-inbox-ack"?"acknowledge":"snooze",reason:key==="m9-inbox-ack"?"Reviewed in the growth inbox":"Follow-up deferred for one day",...(key==="m9-inbox-snooze"?{snoozedUntil:new Date(Date.now()+86400000).toISOString()}:{})};await api(m9Path("/inbox/"+id),{method:"PUT",body});m9.loaded=false;await loadM9();return;}if(key==="agent-retry"){showForm("Retry AI request",input("New instruction","instruction"),"Retry request",async v=>{await api(m9Path("/agent-runs/"+id+"/retry"),{method:"POST",body:{instruction:v.instruction}});closeModal();m9.loaded=false;await loadM9();});return;}if(key==="agent-approve"){const proposal=m9.proposals.find(x=>x._id===id);if(!proposal)return;await api(m9Path("/decisions/"+id+"/decision"),{method:"POST",body:{version:proposal.version,inputHash:proposal.inputHash,decision:"approve",reason:"Approved after workspace review"}});m9.loaded=false;await loadM9();return;}
      if(key.startsWith("content-")){try{return await contentAction(key,id);}catch(e){cms.error=e.message;notify(e.message);render();return;}}
      if(key.startsWith("knowledge-")) return await knowledgeAction(key,id);
      if(key==="crm-log-call"||key==="crm-log-email"||key==="crm-log-meeting"){const type=key.slice("crm-log-".length);showForm("Log "+type,input("Title","title")+input("Details","body","", "text",false),"Save activity",async v=>{const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";await api(p+"/leads/"+id+"/activities",{method:"POST",body:{...v,type}});closeModal();live.crmProfile=await api(p+"/leads/"+id);render();});return;}if(key==="crm-followup-done"){const lead=live.crmProfile?.lead,p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";const item=live.crmProfile.activities.find(a=>a._id===id);await api(p+"/activities/"+id+"/complete",{method:"PATCH",body:{version:item.version}});live.crmProfile=await api(p+"/leads/"+lead._id);render();return;}
      if(key==="crm-stage"){const lead=live.crmProfile?.lead;if(!lead)return;showForm("Update pipeline stage",select("Stage","stage",["new","contacted","qualified","meeting","proposal","lost"],lead.stage),"Save stage",async v=>{const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";await api(p+"/leads/"+id,{method:"PATCH",body:{version:lead.version,stage:v.stage,reason:"Pipeline stage updated"}});closeModal();live.crmLoaded=false;live.crmProfile=null;await loadCrm();});return;}if(key==="crm-assign"){const lead=live.crmProfile?.lead;if(!lead)return;const opts=["Unassigned",...live.crmMembers.map(m=>m.name+" · "+m._id)];showForm("Assign lead",select("Owner","assignee",opts,lead.assignedTo?(live.crmMembers.find(m=>m._id===lead.assignedTo)?.name+" · "+lead.assignedTo):"Unassigned"),"Save assignment",async v=>{const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";const assignee=v.assignee==="Unassigned"?null:v.assignee.split(" · ").pop();await api(p+"/leads/"+id,{method:"PATCH",body:{version:lead.version,assignedTo:assignee,reason:"Lead owner updated"}});closeModal();live.crmProfile=await api(p+"/leads/"+id);render();});return;}if(key==="crm-tab"){live.crmTab=id;render();return;}if(key==="crm-refresh"){live.crmLoaded=false;await loadCrm();return;}if(key==="crm-site"){live.crmSite=live.sites.find(s=>s._id===id)||null;live.crmLoaded=false;await loadCrm();return;}if(key==="crm-close"){live.crmProfile=null;render();return;}if(key==="crm-view"){const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";live.crmProfile=await api(p+"/leads/"+id);render();return;}if(key==="crm-new"){showForm("Add lead",input("Name","name")+input("Email","email","","email",false)+input("Phone","phone","", "tel",false)+input("Company","company","", "text",false)+input("Message","message","", "text",false)+select("Source","source",["manual","website","organic","paid_search","paid_social","referral","email","phone","other"],"manual"),"Save lead",async v=>{const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";await api(p+"/leads",{method:"POST",body:{...v,attribution:{}}});closeModal();notify("Lead saved");live.crmLoaded=false;await loadCrm();});return;}if(key==="crm-note"||key==="crm-followup"){showForm(key==="crm-note"?"Add note":"Schedule follow-up",input("Title","title")+input("Details","body","", "text",false)+(key==="crm-followup"?input("Due date","dueAt","","datetime-local"): ""),key==="crm-note"?"Save note":"Schedule",async v=>{const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";await api(p+"/leads/"+id+"/activities",{method:"POST",body:{...v,type:key==="crm-note"?"note":"follow_up",...(v.dueAt?{dueAt:new Date(v.dueAt).toISOString()}:{})}});closeModal();live.crmProfile=await api(p+"/leads/"+id);render();});return;}if(key==="crm-convert"){const l=live.crmProfile?.lead;const value=prompt("Conversion value (optional)");const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";await api(p+"/leads/"+id+"/convert",{method:"POST",body:{version:l.version,...(value?{value:Number(value)}:{}),reason:"Converted from CRM profile"}});live.crmLoaded=false;live.crmProfile=null;await loadCrm();return;}if(key==="crm-form-new"){showForm("Create website capture form",input("Form name","name")+select("Fields","fields",["name,email,company,message","name,email,phone,message","name,email,phone,company,message"],"name,email,company,message"),"Create form",async v=>{const p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";await api(p+"/capture-forms",{method:"POST",body:{name:v.name,fields:v.fields.split(",")}});closeModal();live.crmLoaded=false;await loadCrm();});return;}if(key==="crm-form-toggle"){const f=live.crmForms.find(x=>x._id===id),p=orgPath("")+"/websites/"+live.crmSite._id+"/crm";await api(p+"/capture-forms/"+id,{method:"PATCH",body:{version:f.version,active:!f.active}});live.crmLoaded=false;await loadCrm();return;}
      switch (key) {

        case "seo-tab":
          live.seoTab=id;render();break;
        case "seo-site":
          live.seoSite=live.sites.find(s=>s._id===id)||null;live.seoLoaded=false;live.seoTab="Overview";await loadSeo(true);break;
        case "seo-reload":
          live.seoLoaded=false;await loadSeo(true);break;
        case "open-seo-issues":
          live.tab="Crawl issues";live.crawlFocus=live.seoSummary&&live.seoSummary.crawl?live.seoSummary.crawl.id:null;state.page="settings";location.hash="settings";await loadTab();render();break;
        case "seo-connect": {
          const p=live.seoProviders.find(x=>x.key===id);if(!p)break;
          showForm("Request provider connection",input("Provider property or account label","property",p.property||"","text",false),"Request authorization",async data=>{
            const body=data.property?{property:data.property}:{};
            if(p.version!==null)body.version=p.version;
            const r=await api(orgPath("/websites/"+live.seoSite._id+"/seo/providers/"+p.key+"/connect"),{method:"POST",body});
            closeModal();notify(r.notice);live.seoLoaded=false;await loadSeo(true);
          });break;
        }
        case "seo-disconnect": {
          const p=live.seoProviders.find(x=>x.key===id);if(!p||p.version===null)break;
          showForm("Disconnect provider",input("Reason","reason","No longer using this provider"),"Disconnect",async data=>{
            await api(orgPath("/websites/"+live.seoSite._id+"/seo/providers/"+p.key+"/disconnect"),{method:"POST",body:{version:p.version,reason:data.reason}});
            closeModal();live.seoLoaded=false;await loadSeo(true);
          });break;
        }
        case "seo-schema-new":
          showForm("Create structured data draft",input("Draft name","name")+input("JSON-LD URL","url","https://"+live.seoSite.domain,"url")+'<label class="field"><span>JSON-LD object</span><textarea name="jsonLd" rows="12" required>{"@context":"https://schema.org","@type":"WebPage","name":"","url":"https://'+esc(live.seoSite.domain)+'/"}</textarea></label>',"Save draft",async data=>{
            let jsonLd;try{jsonLd=JSON.parse(data.jsonLd)}catch{throw Error("Enter valid JSON-LD.");}
            await api(orgPath("/websites/"+live.seoSite._id+"/seo/schema"),{method:"POST",body:{name:data.name,jsonLd}});
            closeModal();live.seoLoaded=false;await loadSeo(true);
          });break;
        case "seo-schema-publish": {
          const draft=live.seoDrafts.find(d=>d._id===id);if(!draft)break;
          if(!live.seoTargets.length){notify(live.seoTargetStatus&&live.seoTargetStatus.reason||"No published WordPress target is available.");break;}
          const options=live.seoTargets.map(t=>'<option value="'+esc(t._id)+'">'+esc(t.title)+' · '+esc(t.liveUrl||"No URL")+'</option>').join("");
          showForm("Publish approved schema",'<p class="helper">This queues only the approved JSON-LD value for the selected published page. The registered WordPress REST meta adapter must be active.</p><label class="field"><span>Published WordPress page</span><select name="contentId" required>'+options+'</select></label>'+input("Reason","reason","Publishing approved schema"),"Queue publication",async data=>{
            const target=live.seoTargets.find(t=>t._id===data.contentId);if(!target)throw Error("Choose a published page.");
            const result=await api(orgPath("/websites/"+live.seoSite._id+"/seo/schema/"+draft._id+"/publish"),{method:"POST",body:{version:draft.version,contentId:target._id,contentVersion:target.version,reason:data.reason}});
            closeModal();notify("Schema publication queued.");live.seoLoaded=false;await loadSeo(true);
          });break;
        }
        case "seo-schema-reconcile": {
          if(!live.seoJobs.find(j=>j._id===id))break;
          showForm("Check WordPress publication outcome",'<p class="helper">This performs a read-only check. It will not repeat a WordPress write.</p>',"Check outcome",async()=>{
            const result=await api(orgPath("/cms/jobs/"+id+"/reconcile"),{method:"POST",body:{}});
            closeModal();notify(result.message);live.seoLoaded=false;await loadSeo(true);
          });break;
        }
        case "seo-schema-cancel": {
          const job=live.seoJobs.find(j=>j._id===id);if(!job)break;
          showForm("Cancel queued schema publication",'<p class="helper">Only an unchanged queued job can be cancelled.</p>',"Cancel queued job",async()=>{
            await api(orgPath("/cms/jobs/"+id+"/cancel"),{method:"POST",body:{version:job.version}});
            closeModal();live.seoLoaded=false;await loadSeo(true);
          });break;
        }
        case "seo-schema-transition": {
          const [schemaId,transition]=a.slice("seo-schema-transition:".length).split(":");const draft=live.seoDrafts.find(d=>d._id===schemaId);if(!draft)break;
          showForm(transition==="approve"?"Approve schema draft":transition==="review"?"Submit schema for independent review":"Archive schema draft",input("Reason","reason","Reviewed in SEO workspace"),transition==="approve"?"Approve":transition==="review"?"Submit for review":"Archive",async data=>{
            await api(orgPath("/websites/"+live.seoSite._id+"/seo/schema/"+schemaId+"/transition"),{method:"POST",body:{version:draft.version,action:transition,reason:data.reason}});
            closeModal();live.seoLoaded=false;await loadSeo(true);
          });break;
        }
        case "live":
          live.active = true;
          state.page = "settings";
          location.hash = "settings";
          if (cfg.apiEnabled) await refresh();
          else render();
          break;
        case "demo":
          live.active = false;
          live.generation++;
          closeModal();
          render();
          break;
        case "settings":
          navigate("settings");
          break;
        case "build-plan":
          modal(
            "Build sequence",
            '<p class="helper">Foundation → Website management and crawler → Brand and Media → Research and Strategy → Content → WordPress → SEO and Indexing → CRM → Analytics → Assisted AI → Billing → Production hardening.</p><div class="note">The approved design stays consistent. Each module connects to real data after the preceding milestone is verified.</div>',
          );
          break;
        case "forgot-password":
          showForm("Reset your password", input("Email address", "email", "", "email"), "Request reset link", async data => {
            const r = await api("/auth/password-reset", { method: "POST", body: data });
            modal("Check your inbox", `<p class="helper">${esc(r.message)}</p>${button("Back to sign in", "sign-in")}`); bindLive();
          });
          break;
        case "send-verification":
          showForm("Send verification email", `<p class="helper">Send a private link to ${esc(live.user.email)}.</p>`, "Send link", async () => {
            const r = await api("/auth/email-verification", { method: "POST", body: {} });
            closeModal(); notify(r.message);
          });
          break;
        case "account":
          state.page = "settings"; closeModal(); await changeTab("Account"); break;
        case "back-workspace":
          await changeTab("Organization"); break;
        case "edit-profile":
          showForm("Edit profile", input("Full name", "name", live.user.name), "Save profile", async data => {
            live.user = await api("/auth/account", { method: "PATCH", body: { ...data, version: live.user.version } });
            closeModal(); await refresh(); notify("Profile saved.");
          }); break;
        case "change-password":
          showForm("Change password", input("Current password", "currentPassword", "", "password") + input("New password (at least 12 characters)", "newPassword", "", "password") + '<p class="helper">All devices will be signed out after this change.</p>', "Change password and sign out", async data => {
            await api("/auth/password", { method: "POST", body: data });
            closeModal(); await refresh(); notify("Password changed. Sign in again."); authForm();
          }); break;
        case "logout-all":
        case "revoke-session":
          showForm(key === "logout-all" ? "Sign out all devices" : "Sign out device", '<p class="helper">The selected sessions will lose account access immediately.</p>', "Confirm sign out", async () => {
            await api(key === "logout-all" ? "/auth/logout-all" : "/auth/sessions/" + id, { method: key === "logout-all" ? "POST" : "DELETE" });
            closeModal(); await refresh();
          }); break;
        case "sign-in":
          authForm();
          break;
        case "sign-up":
          authForm(true);
          break;
        case "create-org":
          orgForm();
          break;
        case "edit-org":
          orgForm(true);
          break;
        case "accept-invite":
          acceptInviteForm();
          break;
        case "workspaces":
          workspacePicker();
          break;
        case "switch":
          live.org = live.orgs.find((o) => o._id === id);
          live.sites = [];
          live.members = [];
          live.invites = [];
          live.audit = [];
          live.auditFilters = {};
          live.crawlSite = null; live.crawlReport = null; live.crawls = []; live.urlItems = [];
          live.tab = "Organization";
          closeModal();
          await refresh();
          break;
        case "tab":
          await changeTab(id);
          break;
        case "retry":
          await refresh();
          break;
        case "sign-out":
          await api("/auth/logout", { method: "POST", body: {} });
          clearCrawlState();
        live.user = null;
          live.org = null;
          live.orgs = [];
          live.sites = [];
          live.members = [];
          live.invites = [];
          live.audit = [];
          live.auditFilters = {};
          live.sessions = [];
          live.securityEvents = [];
          live.generation++;
          closeModal();
          render();
          break;
        case "seo-list": {
          const first=live.crawlReport?.issues?.items?.[0];
          const assignees=first?(await api(crawlPath('/seo/issues/'+first._id))).assignees:[];
          showForm('Filter crawl issues', select('Status','status',['All','open','in_progress','ignored','resolved'],'All')+select('Severity','severity',['All','Critical','High','Medium','Low','Opportunity'],'All')+input('URL contains','search','','text',false)+`<label class="field"><span>Assignee</span><select name="assigneeId"><option value="">Any teammate</option>${assignees.map(u=>`<option value="${esc(u._id)}">${esc(u.name)}</option>`).join('')}</select></label>`, 'Show issues', async data=>{
            live.seoFilter={jobId:live.crawlFocus,...Object.fromEntries(Object.entries(data).filter(([k,v])=>v&&v!=='All'))};live.seoPage=1;await showSeoIssues();
          });break;
        }
        case "seo-more": live.seoPage++;await showSeoIssues();break;
        case "seo-back": live.seoPage=Math.max(1,live.seoPage-1);await showSeoIssues();break;
        case "seo-schemas": {
          const result=await api(crawlPath('/seo/schema'));live.schemaItems=result.items;
          modal('Structured data drafts', `<p class="helper">Validated drafts for review. Approval does not publish to your website or guarantee a rich result. Showing up to 100 recent drafts.</p>${canCrawl()?button('New draft','seo-schema:new',true):''}${result.items.length?result.items.map(x=>`<div class="knowledge"><div><strong>${esc(x.name)}</strong><small>${esc(x.url)}</small>${badge(x.status)}</div>${button('View','seo-schema:'+x._id)}</div>`).join(''):'<div class="empty">No schema drafts yet.</div>'}`);bindLive();break;
        }
        case "seo-schema": {
          const item=id==='new'?null:live.schemaItems.find(x=>x._id===id);
          if(!canCrawl()){modal('Schema draft',`<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(item.jsonLd,null,2))}</pre>${badge(item.status)}`);break;}
          showForm('Schema draft',input('Name','name',item?.name||'')+`<label class="field"><span>JSON-LD (Organization, WebPage or Article)</span><textarea name="jsonLd" rows="12" maxlength="12000">${esc(JSON.stringify(item?.jsonLd||{'@context':'https://schema.org','@type':'WebPage',name:'Page name',url:'https://'+live.crawlSite.domain+'/'},null,2))}</textarea></label><p class="helper">Saving returns this record to draft and clears approval. JSON remains data and is never executed.</p>${item?badge(item.status)+button('Review workflow','seo-schema-decision:'+id):''}`, 'Save draft',async data=>{
            let jsonLd;try{jsonLd=JSON.parse(data.jsonLd);}catch{throw Error('Enter valid JSON.');}
            await api(crawlPath('/seo/schema'+(item?'/'+id:'')),{method:'POST',body:{name:data.name,jsonLd,...(item?{version:item.version}:{})}});closeModal();await run('seo-schemas');
          });bindLive();break;
        }
        case "seo-schema-decision": {
          const item=live.schemaItems.find(x=>x._id===id);
          showForm('Schema review',select('Action','action',['review',...(canPublish()?['approve']:[]),'archive'],'review')+input('Reason','reason','')+'<p class="helper">Approval requires a different reviewer. Unsaved editor changes are not included.</p>', 'Apply',async data=>{await api(crawlPath('/seo/schema/'+id+'/transition'),{method:'POST',body:{version:item.version,...data}});closeModal();await run('seo-schemas');});break;
        }
        case "seo-issue": {
          const detail=await api(crawlPath('/seo/issues/'+id)), w=detail.workflow;
          if(!canCrawl()) { modal('Issue workflow', `<p>${badge(w.status)}</p><p>${esc(w.reason)}</p><p class="helper">You have read-only access.</p>`); break; }
          showForm('Manage crawl issue', `<p>${esc(detail.evidence.url)}</p><p>${badge(w.status)} · version ${w.version}</p>${select('Action','action',['open','in_progress','ignored','recheck'],w.status==='ignored'?'ignored':'in_progress')}<label class="field"><span>Assignee</span><select name="assigneeId"><option value="">Unassigned</option>${detail.assignees.map(u=>`<option value="${esc(u._id)}" ${u._id===w.assigneeId?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>${input('Reason','reason',w.reason||'')}<p class="helper">To recheck, first run a new full crawl. Resolution requires a successful HTML page and no matching issue in that completed, unlimited crawl.</p>`, 'Save workflow', async data=>{
            const updated=await api(crawlPath('/seo/issues/'+id+'/transition'),{method:'POST',body:{version:w.version,action:data.action,assigneeId:data.assigneeId||null,reason:data.reason}});
            closeModal();notify('Issue status: '+updated.status);
          });break;
        }
        case "seo-overview": {
          const site = live.sites.find(s => s._id === id), generation = live.generation;
          live.crawlSite=site;
          modal("SEO overview", '<p role="status" class="helper">Loading crawl evidence…</p>');
          const report = await api(orgPath("/websites/" + id + "/seo/summary"));
          if (generation !== live.generation) return;
          modal("SEO overview · " + esc(site.name), `<p class="helper">Local crawl evidence. Indexability does not confirm search-engine indexing.</p>${report.crawl ? `<p>Audited ${report.auditedPages} URLs · ${esc(new Date(report.crawl.completedAt).toLocaleString())}</p><p>${report.indexable} indexable · ${report.notIndexable} not indexable · ${report.unknown} unknown</p>${report.crawl.truncated || report.crawl.mode !== 'full' ? '<p class="note">Limited crawl coverage. Findings do not represent the entire website.</p>' : ''}<div class="table-scroll"><table><thead><tr><th>Issue</th><th>Severity</th><th>Affected URLs</th><th>Recommended action</th></tr></thead><tbody>${report.issues.map(i=>`<tr><td>${esc(i.type.replaceAll('_',' '))}<small>${esc(i.why)}</small></td><td>${badge(i.severity)}</td><td>${i.count}</td><td>${esc(i.recommendation)}</td></tr>`).join('')}</tbody></table></div>${!report.issues.length ? '<p class="helper">No issues recorded within this crawl.</p>' : ''}` : '<div class="empty">No completed crawl for this domain. Start a crawl to collect evidence.</div>'}<p class="helper">Search Console, rankings and AI visibility: not connected.</p>${button("Schema drafts", "seo-schemas")}${button("Open crawls and URL inventory", "open-crawls:" + id)}`);
          bindLive(); break;
        }
        case "open-crawls":
          closeModal();
          live.crawlSite = live.sites.find(s => s._id === id); live.crawlFocus = null; live.crawlReport = null; live.urlItems = []; live.urlFilters = {}; live.urlPage = 1;
          await changeTab("Crawls"); break;
        case "start-crawl":
          showForm("Start website crawl", select("Crawl mode", "mode", ["full", "sitemap", "single"], "full") + input(`Maximum pages (1–${live.crawlSummary?.limits?.maxPages || 500})`, "maxPages", String(live.crawlSummary?.limits?.defaultPages || 100), "number") + input("Single-page URL (optional)", "startUrl", "", "url", false) + select("Render JavaScript", "renderJs", live.crawlSummary?.limits?.renderJs ? ["No", "Yes"] : ["No"], "No") + '<p class="helper">Ownership verification and robots restrictions are always enforced. JavaScript rendering requires an enabled browser worker.</p>', "Queue crawl", async data => {
            const site = await api(orgPath("/websites/" + live.crawlSite._id));
            await api(crawlPath("/crawls"), { method:"POST", body:{mode:data.mode,maxPages:Number(data.maxPages),renderJs:data.renderJs==="Yes",...(data.startUrl ? {startUrl:data.startUrl} : {}),version:site.version} });
            closeModal(); await changeTab("Crawls"); notify("Crawl queued.");
          }); break;
        case "cancel-crawl": case "retry-crawl": case "rerun-crawl": {
          const job = live.crawls.find(j => j._id === id), operation = key === "cancel-crawl" ? "cancel" : key === "retry-crawl" ? "retry" : "rerun";
          showForm(operation === "cancel" ? "Cancel crawl" : "Queue a new crawl", '<p class="helper">' + (operation === "cancel" ? "Processing will stop. Previous completed inventory is retained." : "A new crawl will use the previous configuration. Existing history is retained.") + '</p>', "Confirm", async () => {
            await api(crawlPath("/crawls/"+id+"/"+operation), {method:"POST",body:{version:job.version}});
            closeModal(); await changeTab("Crawls");
          }); break;
        }
        case "crawl-report": live.crawlFocus = id; live.crawlReport = null; await changeTab("Crawl issues"); break;
        case "more-crawls": case "more-issues": case "more-crawl-errors": {
          const target = key === "more-crawls" ? null : key === "more-issues" ? "issues" : "errors";
          const cursor = target ? live.crawlReport[target].nextCursor : live.cursor;
          if (!cursor) break; const gen = live.generation;
          const result = await api(crawlPath("/crawls" + (target ? "/"+live.crawlFocus+"/"+target : "") + "?cursor="+cursor));
          if (gen !== live.generation) return;
          const items = target ? live.crawlReport[target].items : live.crawls;
          const existing = new Set(items.map(x => x._id)); items.push(...result.items.filter(x => !existing.has(x._id)));
          if (target) live.crawlReport[target].nextCursor=result.nextCursor; else live.cursor=result.nextCursor; render(); break;
        }
        case "urls-next": live.urlPage++; await changeTab("URL Inventory"); break;
        case "urls-prev": live.urlPage=Math.max(1,live.urlPage-1); await changeTab("URL Inventory"); break;
        case "url-clear": live.urlFilters={}; live.urlPage=1; await changeTab("URL Inventory"); break;
        case "url-filter":
          showForm("Filter URL inventory", input("Search URL or title", "search", live.urlFilters.search || "", "text", false) + input("HTTP status code", "statusCode", live.urlFilters.statusCode || "", "number", false) + input("Content type", "contentType", live.urlFilters.contentType || "", "text", false) + [ ["Indexable","indexable"],["In sitemap","inSitemap"],["Has issues","hasIssue"],["Redirect","redirect"] ].map(([label,name])=>select(label,name,["", "true","false"],live.urlFilters[name] || "")).join("") + select("Crawl status","status",["","crawled","blocked","error"],live.urlFilters.status||"") + select("Sort","sort",["-updatedAt","url","-url","statusCode"],live.urlFilters.sort||"-updatedAt"), "Apply", async data => {
            live.urlFilters=Object.fromEntries(Object.entries(data).filter(([,v])=>v!=="")); live.urlPage=1; closeModal(); await changeTab("URL Inventory");
          }); break;
        case "url-detail": {
          const gen=live.generation, item=await api(crawlPath("/urls/"+id)); if(gen!==live.generation)return;
          const d=item.data;
          modal("URL details", `<h3 style="overflow-wrap:anywhere">${esc(item.url)}</h3>${badge(item.status)}${[["Crawl information",{status:d.statusCode,requested:d.requestedUrl,final:d.finalUrl,redirects:d.redirectChain,responseMs:d.responseMs,pageSize:d.pageSize,crawledAt:d.crawledAt}], ["Metadata",{title:d.title,description:d.description,lang:d.lang,canonical:d.canonical,indexable:d.indexable,robots:d.metaRobots,openGraph:d.openGraph,twitter:d.twitter}], ["Headers",d.headers], ["Headings",d.headings], ["Structured data",d.schemaTypes], ["Internal links",d.links.filter(l=>l.internal)], ["External links (not checked)",d.links.filter(l=>!l.internal)], ["Images",d.images], ["Issues",item.issues], ["Recent crawl history",item.history]].map(([label,value])=>`<details><summary>${esc(label)}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(value,null,2))}</pre></details>`).join("")}`,"",true);break;
        }
        case "view-site": {
          const gen = live.generation;
          const site = await api(orgPath("/websites/" + id));
          if (gen !== live.generation) return;
          modal("Website details", `<h3>${esc(site.name)}</h3><p class="helper">${esc(site.domain)}</p>${[ ["CMS", site.cmsType], ["Status", site.status], ["Ownership", site.verificationStatus], ["Verified", site.verifiedAt || "Not verified"], ["Version", site.version], ["Created", site.createdAt], ["Updated", site.updatedAt] ].map(([label, value]) => `<div class="knowledge"><span>${esc(label)}</span><strong>${esc(String(value ?? "—"))}</strong></div>`).join("")}`, "", true);
          break;
        }
        case "add-site":
          siteForm();
          break;
        case "edit-site":
          siteForm(live.sites.find((s) => s._id === id));
          break;
        case "verify-site": {
          const v = await api(orgPath(`/websites/${id}/verification`));
          modal(
            "Verify website ownership",
            `<p class="helper">Add this DNS record at your domain provider. DNS changes may take time to become visible.</p><div class="note"><b>${esc(v.type)} record</b><p style="overflow-wrap:anywhere">Host: ${esc(v.host)}</p><p style="overflow-wrap:anywhere">Value: ${esc(v.value)}</p></div><div id="verify-error"></div>${button("Check DNS record", "check-dns:" + id, true)}`,
          );
          bindLive();
          break;
        }
        case "check-dns": {
          const b = document.querySelector(
            '[data-live="check-dns:' + id + '"]',
          );
          b.disabled = true;
          try {
            await api(orgPath(`/websites/${id}/verify`), {
              method: "POST",
              body: {},
            });
            closeModal();
            await changeTab("Websites");
            notify("Website ownership verified.");
          } catch (e) {
            document.getElementById("verify-error").innerHTML = errorBox(
              e.message,
            );
            b.disabled = false;
          }
          break;
        }
        case "invite":
          showForm(
            "Invite a teammate",
            input("Email address", "email", "", "email") +
              select(
                "Role",
                "role",
                roleNames.filter(
                  (r) => live.org.role === "Owner" || r !== "Admin",
                ),
                "Viewer",
              ),
            "Create invitation",
            async (data) => {
              const inv = await api(orgPath("/invitations"), {
                method: "POST",
                body: data,
              });
              await changeTab("Team & roles");
              const link =
                location.origin +
                location.pathname +
                "#settings?invite=" +
                inv.token;
              modal(
                "Invitation created",
                `<p class="helper">Share this link privately with ${esc(inv.email)}. It expires in seven days. No email has been sent.</p><label class="field"><span>Invitation link</span><textarea readonly>${esc(link)}</textarea></label><p class="helper">The recipient must sign in using the invited email address.</p>`,
              );
            },
          );
          break;
        case "revoke":
          showForm(
            "Revoke invitation",
            '<p class="helper">The invitation link will stop working.</p>',
            "Revoke invitation",
            async () => {
              await api(orgPath("/invitations/" + id), { method: "DELETE" });
              closeModal();
              await changeTab("Team & roles");
            },
          );
          break;
        case "member": {
          const m = live.members.find((m) => m._id === id);
          showForm(
            "Manage " + m.user.name,
            select(
              "Role",
              "role",
              roleNames.filter(
                (r) => live.org.role === "Owner" || r !== "Admin",
              ),
              m.role,
            ) +
              button("Remove member", "remove:" + id) +
              (live.org.role === "Owner"
                ? button("Transfer ownership", "transfer:" + id)
                : ""),
            "Save role",
            async (data) => {
              await api(orgPath("/memberships/" + id), {
                method: "PATCH",
                body: { ...data, version: m.version },
              });
              closeModal();
              await refresh();
            },
          );
          break;
        }
        case "remove":
          showForm(
            "Remove member",
            '<p class="helper">This person will immediately lose access to this workspace.</p>',
            "Remove member",
            async () => {
              await api(orgPath("/memberships/" + id), { method: "DELETE" });
              closeModal();
              await changeTab("Team & roles");
            },
          );
          break;
        case "transfer":
          showForm(
            "Transfer ownership",
            '<p class="helper">This person becomes the workspace owner. Your role changes to Admin.</p>',
            "Transfer ownership",
            async () => {
              const m = live.members.find((m) => m.role === "Owner");
              await api(orgPath("/transfer"), {
                method: "POST",
                body: { membershipId: id, version: m.version },
              });
              closeModal();
              await refresh();
            },
          );
          break;
        case "audit-filter": {
          const f = live.auditFilters;
          showForm("Filter workspace activity",
            '<p class="helper">Action, record type and actor use exact matches. Dates include the full day in UTC.</p>' +
            input("Search action, record type or request ID", "search", f.search || "", "text", false) +
            input("Entity ID", "entityId", f.entityId || "", "text", false) +
            input("Action (for example website.updated)", "action", f.action || "", "text", false) +
            input("Record type (for example website)", "entityType", f.entityType || "", "text", false) +
            input("Actor ID", "actorId", f.actorId || "", "text", false) +
            input("From date (UTC)", "from", f.from?.slice(0, 10) || "", "date", false) +
            input("Through date (UTC)", "to", f.to?.slice(0, 10) || "", "date", false),
            "Apply filters", async data => {
              const filters = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
              if (filters.from) filters.from += "T00:00:00.000Z";
              if (filters.to) filters.to += "T23:59:59.999Z";
              const gen = live.generation, orgId = live.org._id;
              const result = await api(orgPath("/audit-logs?") + new URLSearchParams(filters));
              if (gen !== live.generation || orgId !== live.org?._id) return;
              live.auditFilters = filters; live.audit = result.items; live.cursor = result.nextCursor;
              closeModal(); render();
            });
          break;
        }
        case "audit-clear":
          live.auditFilters = {};
          await changeTab("Audit logs");
          break;
        case "audit-export":
          showForm("Export workspace activity",
            '<p class="helper">Download matching records within the configured export limit as JSON, including before/after values. The export is recorded in workspace activity. Keep the downloaded file private.</p>',
            "Download JSON", async () => {
              const gen = live.generation, orgId = live.org._id;
              const result = await api(orgPath("/audit-logs/export"), { method: "POST", body: live.auditFilters });
              if (gen !== live.generation || orgId !== live.org?._id) return;
              const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
              const link = document.createElement("a");
              link.href = url; link.download = `workspace-audit-${new Date().toISOString().slice(0, 10)}.json`;
              document.body.appendChild(link); link.click(); link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              closeModal(); notify("Audit export downloaded.");
            });
          break;
        case "audit": {
          const a = live.audit.find((a) => a._id === id);
          modal(
            "Activity details",
            `<h3>${esc(a.action)}</h3><p class="helper">${esc(a.requestId)}</p><h3>Before</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(a.before, null, 2))}</pre><h3>After</h3><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(a.after, null, 2))}</pre>`,
            "",
            true,
          );
          break;
        }
        case "more": {
          if (!live.cursor || live.loading) break;
          const isSites = live.tab === "Websites", gen = live.generation;
          const path = orgPath(isSites ? "/websites?cursor=" + live.cursor : "/audit-logs" + auditQuery(live.cursor));
          live.loading = true;
          try {
            const r = await api(path);
            if (gen !== live.generation) return;
            const records = live[isSites ? "sites" : "audit"];
            const existing = new Set(records.map(item => item._id));
            records.push(...r.items.filter(item => !existing.has(item._id)));
            live.cursor = r.nextCursor;
          } finally {
            if (gen === live.generation) { live.loading = false; render(); }
          }
          break;
        }
      }
    } catch (e) {
      live.error = e.message;
      render();
    }
  }
  function bindLive() {
    document.querySelectorAll("[data-live]").forEach(
      (el) =>
        (el.onclick = (e) => {
          e.preventDefault();
          run(el.dataset.live);
        }),
    );
  }
  let polling = false;
  setInterval(async () => {
    if (polling || !live.active || live.loading || live.tab !== "Crawls" || !live.crawlSite || !live.crawls.some(j => ["queued","running"].includes(j.status)) || document.querySelector("#live-form")) return;
    polling = true; const gen = live.generation;
    try { await loadTab(gen); if (gen === live.generation) render(); }
    catch (e) { if (gen === live.generation) { live.error = e.message; render(); } }
    finally { polling = false; }
  }, 5000);
  render();
  const securityParams = new URLSearchParams(location.hash.split("?")[1] || "");
  const securityKind = securityParams.has("reset") ? "reset" : securityParams.has("verify") ? "verify" : null;
  if (securityKind) {
    const token = securityParams.get(securityKind);
    history.replaceState(null, "", location.pathname + "#settings");
    live.active = true; state.page = "settings"; render();
    if (cfg.apiEnabled) tokenForm(securityKind, token);
  }
  if (location.hash.includes("invite=")) {
    live.active = true;
    state.page = "settings";
    if (cfg.apiEnabled)
      refresh().then(() => {
        if (live.user) acceptInviteForm();
        else authForm();
      });
    else render();
  }
})();
