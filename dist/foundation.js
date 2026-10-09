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
  const isManager = () => ["Owner", "Admin"].includes(live.org?.role);
  const button = (label, act, primary = false) =>
    `<button type="button" class="btn ${primary ? "primary" : ""}" data-live="${act}">${esc(label)}</button>`;
  const input = (label, name, value = "", type = "text", required = true) =>
    `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" type="${type}" ${required ? "required" : ""} ${name === "password" ? 'minlength="12" maxlength="128" autocomplete="current-password"' : ""}></label>`;
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
        live.user = null;
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
  const orgPath = (s) => `/organizations/${live.org._id}${s}`;
  async function refresh() {
    const generation = ++live.generation;
    live.loading = true;
    live.error = "";
    render();
    try {
      const user = await api("/auth/me");
      const organizations = await api("/organizations");
      if (generation !== live.generation) return;
      live.user = user;
      live.orgs = organizations.items;
      live.org =
        live.orgs.find((o) => o._id === live.org?._id) || live.orgs[0] || null;
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
    if (!live.org) return;
    const base = orgPath("");
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
      data = await api(base + "/audit-logs");
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
      `${register ? input("Full name", "name") : ""}${input("Email address", "email", "", "email")}${input("Password (at least 12 characters)", "password", "", "password")}<p class="helper">Your account opens a real workspace. Demo records are kept separate.</p>${button(register ? "Already have an account?" : "Create an account", register ? "sign-in" : "sign-up")}`,
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
      `<div style="display:grid;gap:10px">${live.orgs.map((o) => button(`${o.name} · ${o.role}`, "switch:" + o._id)).join("")}${button("Create workspace", "create-org")}${button("Accept invitation", "accept-invite")}${button("Sign out", "sign-out")}</div>`,
    );
    bindLive();
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
      ...(isManager() ? ["Team & roles", "Audit logs"] : []),
    ];
    if (!available.includes(live.tab)) live.tab = "Organization";
    let body = "";
    if (live.tab === "Organization")
      body = `<section class="card padded"><h3>${esc(live.org.name)}</h3><div class="knowledge"><span>Timezone</span><strong>${esc(live.org.timezone)}</strong></div><div class="knowledge"><span>Currency</span><strong>${esc(live.org.currency)}</strong></div><div class="knowledge"><span>Your role</span>${badge(live.org.role)}</div><div class="actions" style="margin-top:24px">${isManager() ? button("Edit preferences", "edit-org", true) : ""}${button("Switch workspace", "workspaces")}${button("Accept invitation", "accept-invite")}</div></section>`;
    if (live.tab === "Websites")
      body = `<section class="card"><div class="card-head"><div><h2>Your websites</h2><p>Verify ownership before starting a crawl.</p></div>${isManager() ? button("Add website", "add-site", true) : ""}</div>${live.sites.length ? `<div class="table-scroll"><table><thead><tr><th>Website</th><th>CMS</th><th>Ownership</th><th>Status</th><th>Actions</th></tr></thead><tbody>${live.sites.map((s) => `<tr><td>${esc(s.name)}<small>${esc(s.domain)}</small></td><td>${esc(s.cmsType)}</td><td>${badge(s.verificationStatus)}</td><td>${badge(s.status)}</td><td><div class="actions">${isManager() ? button("Edit", "edit-site:" + s._id) + (s.status === "active" ? button("Verify", "verify-site:" + s._id) : "") : ""}</div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>No websites yet</strong>Add your first domain to start your website setup.</div>'}${live.cursor ? button("Load more", "more") : ""}</section>`;
    if (live.tab === "Team & roles")
      body = `<section class="card padded"><div class="card-head" style="padding:0 0 20px"><h2>Your team</h2>${button("Invite member", "invite", true)}</div>${live.members.map((m) => `<div class="knowledge"><div><strong>${esc(m.user?.name || "Member")}</strong><small>${esc(m.user?.email || "")}</small></div>${badge(m.role)}<div class="actions">${m.role !== "Owner" && (live.org.role === "Owner" || m.role !== "Admin") ? button("Manage", "member:" + m._id) : ""}</div></div>`).join("")}<h3 style="margin-top:28px">Pending invitations</h3>${live.invites.length ? live.invites.map((i) => `<div class="knowledge"><div><strong>${esc(i.email)}</strong><small>${esc(i.role)} · Expires ${new Date(i.expiresAt).toLocaleDateString()}</small></div>${live.org.role === "Owner" || i.role !== "Admin" ? button("Revoke", "revoke:" + i._id) : ""}</div>`).join("") : '<p class="helper">No pending invitations.</p>'}<p class="helper">Invitations use a private link you share yourself. No email is sent automatically.</p></section>`;
    if (live.tab === "Audit logs")
      body = `<section class="card"><div class="card-head"><h2>Workspace activity</h2><span class="subtle">Saved server records</span></div>${live.audit.length ? `<div class="table-scroll"><table><thead><tr><th>Action</th><th>Record</th><th>Actor</th><th>Time</th></tr></thead><tbody>${live.audit.map((a) => `<tr><td><button class="text-btn" data-live="audit:${a._id}">${esc(a.action)}</button></td><td>${esc(a.entityType)}</td><td>${esc(a.actorId)}</td><td>${esc(new Date(a.occurredAt).toLocaleString("en-IN", { timeZone: live.org.timezone }))}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">No activity yet.</div>'}${live.cursor ? button("Load more", "more") : ""}</section>`;
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
          live.user = null;
          live.org = null;
          live.orgs = [];
          live.sites = [];
          live.members = [];
          live.invites = [];
          live.audit = [];
          live.generation++;
          closeModal();
          render();
          break;
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
          const isSites = live.tab === "Websites";
          const r = await api(
            orgPath(
              (isSites ? "/websites" : "/audit-logs") +
                "?cursor=" +
                live.cursor,
            ),
          );
          live[isSites ? "sites" : "audit"].push(...r.items);
          live.cursor = r.nextCursor;
          render();
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
  render();
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
