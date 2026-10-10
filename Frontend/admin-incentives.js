// ==========================================================================
// ADMIN INCENTIVE CONTROL CENTRE
//   Money-safety principles baked into this page:
//   - The program starts OFF, can run in SHADOW mode (records what it would
//     have paid, pays nothing), and has a one-click pause.
//   - The server enforces every cap and budget. This page shows them, lets
//     authorised admins change them, and never computes a payout itself.
//   - Every consequential action asks for a written reason, which the
//     backend stores in the audit log with the admin's name.
//   See INCENTIVES_INTEGRATION.md for the endpoint contract.
// ==========================================================================
var adminUser = requireAuth("admin");

document.addEventListener("DOMContentLoaded", function () {
  if (!adminUser) return;
  wireLogoutButton();

  var $ = function (id) { return document.getElementById(id); };
  var naira = function (n) { return "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG"); };
  var pct = function (a, b) { return b > 0 ? Math.round(a / b * 100) : 0; };
  var fmtDate = function (d) { return d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"; };
  var E = escapeHtml;

  function api(path, method, body) {
    var o = { method: method || "GET" };
    if (body) { o.headers = { "Content-Type": "application/json" }; o.body = JSON.stringify(body); }
    return authFetch(API_BASE + "/admin/incentives" + path, o).then(function (r) { return r.json(); });
  }

  // Conservative launch values. Past-question downloads cost ₦200–₦600+, so a
  // ₦100 reward is a fraction of one download, never a free one.
  var RECOMMENDED = {
    monthlyBudget: 20000, weeklyCap: 300, holdDays: 3, maxSinglePayout: 250, adminDailyLimit: 3000, ratioAlert: 40,
    rewards: { pastQuestion: 100, lectureNote: 60, high: 150, rare: 200, firstApproval: 50, referralSignup: 0, referralFirstApproval: 50 }
  };
  var RULE_FIELDS = [
    ["Spending limits"],
    ["monthlyBudget", "Monthly reward budget (₦)", "Rewards pause automatically when this is reached."],
    ["weeklyCap", "Weekly earning cap per student (₦)", "No student can earn more than this in 7 days."],
    ["maxSinglePayout", "Largest single payout (₦)", "No single approval can pay more than this, whatever tier is picked."],
    ["adminDailyLimit", "Daily award limit per moderator (₦)", "Stops one moderator paying out large totals in a day."],
    ["Protecting paid revenue"],
    ["holdDays", "Days before rewards become spendable", "Gives you time to reverse duplicates and fraud first."],
    ["ratioAlert", "Warn me when rewards exceed this % of funded revenue", "Shows an alert on the Overview tab."],
    ["Reward amounts (₦)"],
    ["rewards.pastQuestion", "Standard: past question", ""],
    ["rewards.lectureNote", "Standard: lecture note", ""],
    ["rewards.high", "High-value tier", "Complete multi-year collections. Needs a written reason."],
    ["rewards.rare", "Rare tier", "Material Sharef does not have yet. Needs a written reason."],
    ["rewards.firstApproval", "First approved upload bonus", "One time per student."],
    ["rewards.referralSignup", "Referral: friend signs up", "Recommended 0. Sign-ups alone are easy to fake."],
    ["rewards.referralFirstApproval", "Referral: friend's first upload approved", "Paid to the inviter."]
  ];
  var get = function (o, p) { return p.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); };
  var setp = function (o, p, v) { var ks = p.split("."), x = o; ks.slice(0, -1).forEach(function (k) { x = x[k] = x[k] || {}; }); x[ks[ks.length - 1]] = v; };

  var cfg = null, loaded = {};

  // ---- tabs ---------------------------------------------------------------
  function switchTab(name) {
    document.querySelectorAll(".page-tabs .tab-btn").forEach(function (b) {
      var on = b.dataset.tab === name; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on);
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.toggle("hidden", p.id !== "panel_" + name); });
    if (!loaded[name]) { loaded[name] = true; ({ payouts: loadPayouts, flags: loadFlags, requests: loadRequests, rules: loadRules }[name] || function () {})(); }
  }
  document.querySelectorAll(".page-tabs .tab-btn").forEach(function (b) { b.addEventListener("click", function () { switchTab(b.dataset.tab); }); });

  // ---- confirm dialog with mandatory reason -------------------------------
  var modal = $("rwaModal"), modalCb = null;
  function confirmWithReason(title, text, okLabel, cb) {
    $("rwaModalTitle").textContent = title; $("rwaModalText").textContent = text;
    $("rwaModalReason").value = ""; $("rwaModalErr").textContent = ""; $("rwaModalOk").textContent = okLabel;
    modalCb = cb; modal.classList.remove("hidden"); $("rwaModalReason").focus();
  }
  $("rwaModalCancel").onclick = function () { modal.classList.add("hidden"); modalCb = null; };
  $("rwaModalOk").onclick = function () {
    var reason = $("rwaModalReason").value.trim();
    if (reason.length < 5) { $("rwaModalErr").textContent = "Enter a reason of at least 5 characters."; return; }
    var cb = modalCb; $("rwaModalOk").disabled = true;
    Promise.resolve(cb(reason)).then(function (ok) { if (ok !== false) { modal.classList.add("hidden"); modalCb = null; } else $("rwaModalOk").disabled = false; }).then(function () { $("rwaModalOk").disabled = false; });
  };
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("rwaModalCancel").click(); });

  // ---- OVERVIEW ------------------------------------------------------------
  var STATUS_COPY = {
    off: ["Off", "Students cannot see rewards and nothing is paid. Start with shadow mode to see what rewards would cost before spending anything."],
    shadow: ["Shadow mode", "Approvals record what would have been paid, but no money moves and students see nothing. Use this for a week to learn the real cost."],
    live: ["Live", "Approved uploads pay rewards into students' wallets within the limits below."],
    paused: ["Paused", "No new rewards are paid. Students still see their balance and can keep uploading."]
  };
  function statusButtons(s) {
    var b = function (to, label, cls) { return '<button type="button" class="btn-lg ' + cls + '" data-to="' + to + '">' + label + "</button>"; };
    if (s === "off") return b("shadow", "Start shadow mode", "btn-success") + b("live", "Go live", "btn-secondary");
    if (s === "shadow") return b("live", "Go live", "btn-success") + b("off", "Turn off", "btn-secondary");
    if (s === "live") return b("paused", "Pause rewards", "btn-reject") + b("off", "Turn off", "btn-secondary");
    return b("live", "Resume", "btn-success") + b("off", "Turn off", "btn-secondary");
  }
  function loadOverview() {
    api("/summary").then(function (d) {
      if (!d.success) throw 0;
      $("rwaState").classList.add("hidden");
      cfg = d.config || {};
      var s = d.status || "off", c = STATUS_COPY[s] || STATUS_COPY.off;
      $("rwaStatus").innerHTML = '<div><span class="rwa-pill ' + E(s) + '">' + c[0] + "</span><h2>Rewards: " + c[0].toLowerCase() + "</h2><p>" + c[1] + '</p></div><div class="acts">' + statusButtons(s) + "</div>";
      $("rwaStatus").querySelectorAll("[data-to]").forEach(function (btn) { btn.onclick = function () { changeStatus(btn.dataset.to, s, d); }; });

      var b = d.budget || {}, paid = b.paidThisMonth || 0, cap = b.monthlyCap || 0, usedPct = pct(paid, cap);
      var ratio = d.fundedRevenue > 0 ? Math.round(paid / d.fundedRevenue * 100) : null;
      var alerts = (d.alerts || []).slice();
      if (cap > 0 && usedPct >= 80) alerts.unshift({ level: usedPct >= 100 ? "bad" : "warn", text: "Rewards have used " + usedPct + "% of this month's budget." + (usedPct >= 100 ? " New rewards are paused automatically." : "") });
      if (ratio != null && cfg.ratioAlert && ratio > cfg.ratioAlert) alerts.unshift({ level: "bad", text: "Rewards are " + ratio + "% of funded revenue, above your " + cfg.ratioAlert + "% limit." });
      $("rwaAlerts").innerHTML = alerts.map(function (a) { return '<div class="rwa-alert ' + (a.level === "bad" ? "bad" : "") + '">' + E(a.text) + "</div>"; }).join("");

      var stat = function (label, val, note, cls) { return '<div class="rwa-stat ' + (cls || "") + '"><span>' + label + "</span><strong>" + val + "</strong><small>" + note + "</small></div>"; };
      $("rwaStats").innerHTML =
        '<div class="rwa-stat ' + (usedPct >= 100 ? "bad" : usedPct >= 80 ? "warn" : "") + '"><span>Paid this month</span><strong>' + naira(paid) + (cap ? " of " + naira(cap) : "") + '</strong><div class="rwa-meter ' + (usedPct >= 100 ? "bad" : usedPct >= 80 ? "warn" : "") + '"><i style="width:' + Math.min(100, usedPct) + '%"></i></div><small>' + (cap ? usedPct + "% of budget used" : "No budget set. Set one in Rules before going live.") + "</small></div>" +
        stat("Owed to students", naira(d.outstanding), "Unspent reward balance. This is your real liability.") +
        stat("Spent on downloads", naira(d.redeemed), "Rewards students have already used.") +
        stat("Funded revenue", naira(d.fundedRevenue), "Real money added to wallets this month.") +
        stat("Rewards vs revenue", ratio == null ? "—" : ratio + "%", "Reward cost as a share of funded revenue.", ratio != null && cfg.ratioAlert && ratio > cfg.ratioAlert ? "bad" : "") +
        stat("Cost per approved upload", d.approvedCount ? naira(paid / d.approvedCount) : "—", (d.approvedCount || 0) + " approved this month.");

      var admins = d.admins || [];
      $("rwaAdmins").innerHTML = admins.length ? admins.map(function (a) {
        return "<tr><td>" + E(a.name) + "</td><td>" + a.approvals + "</td><td>" + naira(a.paid) + "</td><td>" + naira(a.approvals ? a.paid / a.approvals : 0) + "</td><td>" + (a.highRare || 0) + '</td><td>' + (a.flagged ? '<span class="rwa-pill bad">' + E(a.flagged) + "</span>" : '<span class="rwa-pill">Normal</span>') + "</td></tr>";
      }).join("") : '<tr><td colspan="6" class="rwa-empty">No payouts yet this month.</td></tr>';

      setCount("flags", d.flagsOpen); var fc = $("sidebarFlagCount"); if (fc) { fc.textContent = d.flagsOpen || 0; fc.style.display = d.flagsOpen ? "" : "none"; }
    }).catch(function () {
      $("rwaState").textContent = "The incentive service is not connected yet. Nothing is being paid. Connect the endpoints in INCENTIVES_INTEGRATION.md to use this page.";
    });
  }
  function setCount(tab, n) { var el = $("cnt_" + tab); el.textContent = n || ""; el.style.display = n ? "" : "none"; }

  function changeStatus(to, from, d) {
    if (to === "live" && !(d.budget && d.budget.monthlyCap > 0)) { alert("Set a monthly reward budget in Rules before going live."); switchTab("rules"); return; }
    var titles = { shadow: "Start shadow mode?", live: from === "paused" ? "Resume rewards?" : "Go live with rewards?", paused: "Pause rewards?", off: "Turn rewards off?" };
    var texts = { shadow: "No money moves. Approvals only record what would have been paid.", live: "Approved uploads will start paying real rewards within your limits.", paused: "New rewards stop immediately. Existing balances stay.", off: "Students stop seeing rewards and nothing is paid or recorded." };
    confirmWithReason(titles[to], texts[to], "Confirm", function (reason) {
      return api("/status", "POST", { status: to, reason: reason }).then(function (r) {
        if (!r.success) { $("rwaModalErr").textContent = r.message || "Could not change status."; return false; }
        loaded = {}; loadOverview(); try { sessionStorage.removeItem("sharefRewardsCfg"); } catch (e) {}
      }).catch(function () { $("rwaModalErr").textContent = "Network error."; return false; });
    });
  }

  // ---- PAYOUTS -------------------------------------------------------------
  var payPage = 1, payTimer;
  function loadPayouts() {
    var q = new URLSearchParams({ page: payPage, status: $("payStatus").value, q: $("payQ").value.trim() });
    api("/payouts?" + q).then(function (d) {
      var rows = d.payouts || [];
      $("payBody").innerHTML = rows.length ? rows.map(function (p) {
        var canRev = p.status === "pending" || p.status === "cleared";
        return "<tr><td>" + fmtDate(p.date) + "</td><td>" + E(p.student) + "</td><td>" + E(p.label) + "</td><td>" + E(p.tier || "—") + "</td><td>" + naira(p.amount) + '</td><td><span class="rwa-pill ' + E(p.status) + '">' + E(p.status) + "</span></td><td>" + E(p.approvedBy || "—") + "</td><td>" +
          (canRev ? '<button class="btn-sm btn-reject" data-rev="' + E(p.id) + '">Reverse</button>' : "") + "</td></tr>";
      }).join("") : '<tr><td colspan="8" class="rwa-empty">No payouts match.</td></tr>';
      var pg = d.pagination || { page: 1, pages: 1 }; payPage = pg.page;
      $("payInfo").textContent = "Page " + pg.page + " of " + pg.pages; $("payPrev").disabled = pg.page <= 1; $("payNext").disabled = pg.page >= pg.pages;
      $("payBody").querySelectorAll("[data-rev]").forEach(function (b) {
        b.onclick = function () {
          confirmWithReason("Reverse this payout?", "The reward is taken back from the student's balance. If they already spent it, their balance can go negative and block downloads until topped up.", "Reverse payout", function (reason) {
            return api("/payouts/" + encodeURIComponent(b.dataset.rev) + "/reverse", "POST", { reason: reason }).then(function (r) {
              if (!r.success) { $("rwaModalErr").textContent = r.message || "Could not reverse."; return false; } loadPayouts();
            });
          });
        };
      });
    }).catch(function () { $("payBody").innerHTML = '<tr><td colspan="8" class="rwa-empty">Could not load payouts.</td></tr>'; });
  }
  $("payPrev").onclick = function () { payPage--; loadPayouts(); }; $("payNext").onclick = function () { payPage++; loadPayouts(); };
  $("payStatus").onchange = function () { payPage = 1; loadPayouts(); };
  $("payQ").oninput = function () { clearTimeout(payTimer); payTimer = setTimeout(function () { payPage = 1; loadPayouts(); }, 350); };

  // ---- FLAGS ---------------------------------------------------------------
  function loadFlags() {
    api("/flags?status=open").then(function (d) {
      var f = d.flags || []; setCount("flags", f.length);
      $("flagList").innerHTML = f.length ? f.map(function (x) {
        return '<div class="rwa-flag"><div><strong>' + E(x.student) + '</strong> <span class="rwa-pill bad">' + naira(x.exposure) + " earned in rewards</span><ul>" + (x.signals || []).map(function (s) { return "<li>" + E(s) + "</li>"; }).join("") + '</ul></div><div class="acts">' +
          '<button class="btn-sm btn-reject" data-f="' + E(x.id) + '" data-a="freeze">Freeze rewards</button><button class="btn-sm btn-reject" data-f="' + E(x.id) + '" data-a="reverse_all">Reverse all</button><button class="btn-sm btn-preview" data-f="' + E(x.id) + '" data-a="dismiss">Dismiss</button></div></div>';
      }).join("") : '<div class="rwa-empty">No open flags. Signals include repeat duplicates, referral rings and accounts that earn but never spend.</div>';
      var L = { freeze: "Freeze rewards", reverse_all: "Reverse all rewards", dismiss: "Dismiss flag" };
      $("flagList").querySelectorAll("[data-f]").forEach(function (b) {
        b.onclick = function () {
          confirmWithReason(L[b.dataset.a] + "?", b.dataset.a === "dismiss" ? "The account is treated as normal again." : "This takes effect immediately and is recorded in the audit log.", "Confirm", function (reason) {
            return api("/flags/" + encodeURIComponent(b.dataset.f) + "/resolve", "POST", { action: b.dataset.a, note: reason }).then(function (r) {
              if (!r.success) { $("rwaModalErr").textContent = r.message || "Could not apply."; return false; } loadFlags(); loadOverview();
            });
          });
        };
      });
    }).catch(function () { $("flagList").innerHTML = '<div class="rwa-empty">Could not load flags.</div>'; });
  }

  // ---- REQUESTS ------------------------------------------------------------
  function loadRequests() {
    api("/requests").then(function (d) {
      var r = d.requests || [];
      $("reqBody").innerHTML = r.length ? r.map(function (q) {
        return "<tr><td>" + E(q.course) + " " + E(q.type) + " (" + E(q.level) + ")</td><td>" + naira(q.reward) + "</td><td>" + (q.paid || 0) + " / " + q.maxPayouts + "</td><td>" + fmtDate(q.expiresAt) + '</td><td><span class="rwa-pill ' + (q.status === "open" ? "live" : "") + '">' + E(q.status) + "</span></td><td>" + (q.status === "open" ? '<button class="btn-sm btn-reject" data-close="' + E(q.id) + '">Close</button>' : "") + "</td></tr>";
      }).join("") : '<tr><td colspan="6" class="rwa-empty">No requests yet.</td></tr>';
      $("reqBody").querySelectorAll("[data-close]").forEach(function (b) {
        b.onclick = function () { confirmWithReason("Close this request?", "Students can no longer claim it. Approved uploads are still paid.", "Close request", function (reason) {
          return api("/requests/" + encodeURIComponent(b.dataset.close) + "/close", "POST", { reason: reason }).then(function (x) { if (!x.success) { $("rwaModalErr").textContent = x.message || "Could not close."; return false; } loadRequests(); });
        }); };
      });
    }).catch(function () { $("reqBody").innerHTML = '<tr><td colspan="6" class="rwa-empty">Could not load requests.</td></tr>'; });
  }
  $("reqForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var reward = Number($("reqReward").value), max = (cfg && cfg.maxSinglePayout) || RECOMMENDED.maxSinglePayout, msg = $("reqMsg");
    if (!$("reqCourse").value.trim() || !$("reqExpires").value || !(reward > 0)) { msg.textContent = "Fill in course, reward and closing date."; return; }
    if (reward > max) { msg.textContent = "Reward cannot exceed the largest single payout (" + naira(max) + ")."; return; }
    api("/requests", "POST", { course: $("reqCourse").value.trim().toUpperCase(), type: $("reqType").value, level: $("reqLevel").value, reward: reward, maxPayouts: Math.min(3, Math.max(1, Number($("reqMax").value) || 1)), expiresAt: $("reqExpires").value })
      .then(function (r) { msg.textContent = r.success ? "Published." : (r.message || "Could not publish."); if (r.success) { $("reqForm").reset(); loadRequests(); } })
      .catch(function () { msg.textContent = "Network error."; });
  });

  // ---- RULES + AUDIT -------------------------------------------------------
  function renderRules(c) {
    $("rulesFields").innerHTML = RULE_FIELDS.map(function (f) {
      if (f.length === 1) return '<div class="rwa-group">' + f[0] + "</div>";
      return '<label class="rwa-field">' + f[1] + '<input type="number" min="0" step="1" data-k="' + f[0] + '" value="' + E(get(c, f[0]) == null ? "" : get(c, f[0])) + '" />' + (f[2] ? "<small>" + f[2] + "</small>" : "") + "</label>";
    }).join("");
    $("rulesFields").oninput = checkRules; checkRules();
  }
  function readRules() { var o = {}; document.querySelectorAll("#rulesFields [data-k]").forEach(function (i) { setp(o, i.dataset.k, i.value === "" ? null : Number(i.value)); }); return o; }
  function checkRules() {
    var r = readRules(), rw = r.rewards || {}, top = Math.max(rw.pastQuestion || 0, rw.lectureNote || 0, rw.high || 0, rw.rare || 0, rw.referralFirstApproval || 0), w = [];
    if (r.maxSinglePayout && top > r.maxSinglePayout) w.push("A reward tier is above your largest single payout. It will be cut down to " + naira(r.maxSinglePayout) + ".");
    if (r.weeklyCap && r.weeklyCap < top) w.push("The weekly cap is below your top reward, so one approval could hit the cap.");
    if (!r.holdDays) w.push("With no hold period you cannot reverse fraud before rewards are spent.");
    if (r.weeklyCap) w.push("Worst case per active contributor: " + naira(r.weeklyCap * 4) + " a month. Monthly budget covers about " + (r.weeklyCap ? Math.floor((r.monthlyBudget || 0) / (r.weeklyCap * 4)) : 0) + " contributors at that rate.");
    $("rulesWarn").innerHTML = w.map(E).join("<br>");
  }
  function loadRules() {
    api("/config").then(function (d) { if (d.success) { cfg = d; renderRules(d); } else throw 0; }).catch(function () { $("rulesFields").innerHTML = '<div class="rwa-empty">Could not load rules.</div>'; });
    api("/audit").then(function (d) {
      var a = d.entries || [];
      $("auditBody").innerHTML = a.length ? a.map(function (x) { return "<tr><td>" + fmtDate(x.date) + "</td><td>" + E(x.admin) + "</td><td>" + E(x.action) + "</td><td>" + E(x.detail) + "</td></tr>"; }).join("") : '<tr><td colspan="4" class="rwa-empty">No changes recorded.</td></tr>';
    }).catch(function () {});
  }
  $("useRecommended").onclick = function () { renderRules(RECOMMENDED); };
  $("rulesForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var r = readRules();
    if (!(r.monthlyBudget > 0) || !(r.weeklyCap > 0)) { $("rulesWarn").textContent = "Monthly budget and weekly cap must be above zero."; return; }
    confirmWithReason("Save reward rules?", "New values apply to future payouts only.", "Save rules", function (reason) {
      return api("/config", "PUT", { rules: r, reason: reason }).then(function (x) {
        if (!x.success) { $("rwaModalErr").textContent = x.message || "Could not save."; return false; }
        try { sessionStorage.removeItem("sharefRewardsCfg"); } catch (e2) {} loadRules(); loadOverview();
      }).catch(function () { $("rwaModalErr").textContent = "Network error."; return false; });
    });
  });

  loadOverview();
});
