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
  function clearCrawlState() { live.crawlSite=null; live.crawls=[]; live.crawlFocus=null; live.crawlSummary=null; live.crawlReport=null; live.urlItems=[]; live.urlFilters={}; live.urlPage=1; live.urlTotal=0; }
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
      body = `<section class="card"><div class="card-head"><div><h2>Your websites</h2><p>Verify ownership before starting a crawl.</p></div>${isManager() ? button("Add website", "add-site", true) : ""}</div>${live.sites.length ? `<div class="table-scroll"><table><thead><tr><th>Website</th><th>CMS</th><th>Ownership</th><th>Status</th><th>Actions</th></tr></thead><tbody>${live.sites.map((s) => `<tr><td>${esc(s.name)}<small>${esc(s.domain)}</small></td><td>${esc(s.cmsType)}</td><td>${badge(s.verificationStatus)}</td><td>${badge(s.status)}</td><td><div class="actions">${button("View", "view-site:" + s._id)}${button("Crawls", "open-crawls:" + s._id)}${isManager() ? button("Edit", "edit-site:" + s._id) + (s.status === "active" ? button("Verify", "verify-site:" + s._id) : "") : ""}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>No websites yet</strong>Add your first domain to start your website setup.</div>'}${live.cursor ? button("Load more", "more") : ""}</section>`;
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
  function crawlerPanel() {
    const site = live.crawlSite;
    const heading = `<div class="card-head"><div><h2>${esc(site.name)}</h2><p>${esc(site.domain)}</p></div><div class="actions">${button("Websites", "tab:Websites")}${canCrawl() ? button("Start crawl", "start-crawl", true) : ""}</div></div>`;
    if (live.tab === "Crawls") {
      const summary = live.crawlSummary;
      return `<section class="card">${heading}<div class="padded"><p class="helper">${summary ? `${summary.total} stored URLs · ${summary.indexable} indexable · ${summary.notIndexable} not indexable` : "No completed crawl yet."}</p>${site.verificationStatus !== "verified" ? '<p class="note">Verify website ownership before starting a crawl.</p>' : ""}</div>${live.crawls.length ? `<div class="table-scroll"><table><thead><tr><th>Crawl / status</th><th>Progress</th><th>Started / completed</th><th>Duration</th><th>Errors</th><th>Actions</th></tr></thead><tbody>${live.crawls.map(j => `<tr><td><small>${esc(j._id)}</small>${badge(j.status)}${j.error ? `<small>${esc(j.error)}</small>` : ""}</td><td><progress max="100" value="${j.progress || 0}" aria-label="Crawl progress"></progress><small>${j.progress || 0}% · ${j.crawled || 0}/${j.discovered || 0} pages</small><small>${j.successCount || 0} successful · ${j.redirectCount || 0} redirects</small>${j.lastUrl ? `<small>${esc(j.lastUrl)}</small>` : ""}${j.truncated ? '<small>Configured crawl limit reached</small>' : ""}</td><td><small>${esc(j.startedAt || "Queued")}</small><small>${esc(j.completedAt || "—")}</small></td><td>${Math.round((j.durationMs || (j.startedAt ? Date.now()-Date.parse(j.startedAt) : 0))/1000)}s</td><td>${j.errorCount || 0}</td><td><div class="actions">${button("Report", "crawl-report:" + j._id)}${canCrawl() ? (["queued","running"].includes(j.status) ? button("Cancel", "cancel-crawl:" + j._id) : button("Re-run", "rerun-crawl:" + j._id) + (["failed","completed_with_errors","cancelled"].includes(j.status) ? button("Retry", "retry-crawl:" + j._id) : "")) : ""}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>No crawls yet</strong>Start a crawl of your verified website to discover its pages.</div>'}${live.cursor ? button("More crawls", "more-crawls") : ""}</section>`;
    }
    if (live.tab === "URL Inventory") return `<section class="card">${heading}<div class="card-head"><span>${live.urlTotal} matching URLs</span><div class="actions">${button("Filter URLs", "url-filter")}${button("Clear filters", "url-clear")}</div></div>${live.urlItems.length ? `<div class="table-scroll"><table><thead><tr><th>URL / title</th><th>Status</th><th>Indexability</th><th>Canonical</th><th>Content type</th><th>Sitemap</th><th>Incoming links</th><th>Last crawled</th></tr></thead><tbody>${live.urlItems.map(p => `<tr><td><button class="text-btn" data-live="url-detail:${p._id}">${esc(p.url)}</button><small>${esc(p.data?.title || "No title")}</small></td><td>${badge(String(p.data?.statusCode || p.status))}<small>${p.issues.length} issues</small></td><td>${badge(p.data?.indexable ? "Indexable" : "Not indexable")}</td><td>${esc(p.data?.canonical || "—")}</td><td>${esc(p.data?.contentType || "—")}</td><td>${p.inSitemap ? "Yes" : "No"}</td><td>${p.incomingLinks || 0}</td><td>${esc(p.data?.crawledAt || "—")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No matching URLs. Complete a crawl or adjust the filters.</div>'}<div class="card-head"><span>Page ${live.urlPage}</span><div class="actions">${live.urlPage > 1 ? button("Previous", "urls-prev") : ""}${live.urlPage*25 < live.urlTotal ? button("Next", "urls-next") : ""}</div></div></section>`;
    const report = live.crawlReport;
    return `<section class="card">${heading}<div class="padded">${!report ? '<div class="empty">Open a crawl report from the Crawls tab.</div>' : `<h3>Technical issues</h3><p class="helper">Issues reflect this crawl's coverage. Orphan and duplicate content findings are candidates for review.</p>${report.issues.items.length ? report.issues.items.map(i => `<div class="knowledge"><div>${badge(i.severity)}<strong>${esc(i.type.replaceAll("_"," "))}</strong><small>${esc(i.url)}</small><p>${esc(i.why)}</p><p class="helper">${esc(i.recommendation)}</p></div></div>`).join("") : '<p class="helper">No issues recorded for this crawl.</p>'}${report.issues.nextCursor ? button("More issues", "more-issues") : ""}<h3>Robots.txt</h3>${report.robots.items.map(r => `<p>${badge(r.status)} ${esc(r.url)}</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.body || r.error || "No robots rules found")}</pre>`).join("") || '<p class="helper">Robots information is not available yet.</p>'}<h3>Sitemaps</h3>${report.sitemaps.items.map(m => `<details><summary>${esc(m.url)} · ${esc(m.status)} · ${m.urls?.length || 0} URLs</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(m.urls || m.error, null, 2))}</pre></details>`).join("") || '<p class="helper">No sitemaps recorded.</p>'}<h3>Crawl errors</h3>${report.errors.items.map(e => `<p>${esc(e.url)} — ${esc(e.code)}</p>`).join("") || '<p class="helper">No crawl errors recorded.</p>'}${report.errors.nextCursor ? button("More errors", "more-crawl-errors") : ""}`}</div></section>`;
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
      if (a === "menu" || a === "close") return originalAction(a);
      if (a === "help") return run("build-plan");
      return;
    }
    return originalAction(a);
  };
  async function run(a) {
    const [key, id] = a.split(":");
    try {
      switch (key) {
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
        case "open-crawls":
          live.crawlSite = live.sites.find(s => s._id === id); live.crawlFocus = null; live.crawlReport = null; live.urlItems = []; live.urlFilters = {}; live.urlPage = 1;
          await changeTab("Crawls"); break;
        case "start-crawl":
          showForm("Start website crawl", select("Crawl mode", "mode", ["full", "sitemap", "single"], "full") + input("Maximum pages (1–500)", "maxPages", "100", "number") + input("Single-page URL (optional)", "startUrl", "", "url", false) + select("Render JavaScript", "renderJs", ["No", "Yes"], "No") + '<p class="helper">Ownership verification and robots restrictions are always enforced. JavaScript rendering requires an enabled browser worker.</p>', "Queue crawl", async data => {
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
