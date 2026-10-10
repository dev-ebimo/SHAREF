// ==========================================================================
// SHAREF REWARDS — shared student-side module
//   Loaded on every student page right after dashboard.js (so requireAuth,
//   authFetch, escapeHtml and window.SharefWallet already exist).
//
//   Design rules this file follows:
//   1. FAIL SILENT. If the incentive endpoints don't exist yet, return an
//      error, or the program is switched off by an admin, every reward UI
//      stays hidden and the rest of the site behaves exactly as before.
//   2. The server is the only authority on amounts, caps and eligibility.
//      This file only displays what /incentives/* returns.
//   3. Rewards are paid in Naira into the existing Study Wallet. There is
//      no second currency to explain to students.
// ==========================================================================
(function () {
  var user = (typeof currentUser !== "undefined" && currentUser) || null;
  if (!user || user.role === "admin") return;

  var CFG_KEY = "sharefRewardsCfg";
  var CFG_TTL = 2 * 60 * 1000;

  function naira(n) { return "₦" + Math.round(Number(n) || 0).toLocaleString("en-NG"); }

  function getJson(path) {
    return authFetch(API_BASE + path).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.success === false) throw new Error("incentives unavailable");
      return d;
    });
  }

  function loadConfig(force) {
    if (!force) {
      try {
        var c = JSON.parse(sessionStorage.getItem(CFG_KEY) || "null");
        if (c && Date.now() - c.at < CFG_TTL) return Promise.resolve(c.data);
      } catch (e) {}
    }
    return getJson("/incentives/config").then(function (d) {
      try { sessionStorage.setItem(CFG_KEY, JSON.stringify({ at: Date.now(), data: d })); } catch (e) {}
      return d;
    });
  }

  // A program is "visible" to students when an admin has switched it to
  // live or paused. "off" (the default) hides every reward surface.
  function isVisible(cfg) { return !!cfg && cfg.enabled !== false && (cfg.status === "live" || cfg.status === "paused"); }

  window.SharefRewards = {
    naira: naira,
    loadConfig: loadConfig,
    isVisible: isVisible,
    getJson: getJson,
  };

  document.addEventListener("DOMContentLoaded", function () {
    loadConfig().then(function (cfg) {
      if (!isVisible(cfg)) return;
      document.querySelectorAll(".rewards-nav-link").forEach(function (el) { el.style.display = ""; });
      var sec = document.getElementById("rewardsDashSection");
      if (sec) renderDashboardStrip(sec, cfg);
    }).catch(function () { /* program unavailable — stay hidden */ });
  });

  function renderDashboardStrip(sec, cfg) {
    var body = document.getElementById("rewardsDashBody");
    Promise.all([getJson("/incentives/me"), getJson("/incentives/requests").catch(function () { return { requests: [] }; })])
      .then(function (r) {
        var me = r[0], reqs = (r[1].requests || []).slice(0, 2);
        var paused = cfg.status === "paused";
        body.innerHTML =
          '<div class="rw-card rw-card-main">' +
            '<span class="rw-label">Rewards earned</span>' +
            '<strong class="rw-big">' + naira(me.balance && me.balance.reward) + '</strong>' +
            '<span class="rw-sub">' + (paused ? "Rewards are paused right now. Approved uploads are still recorded." : "Spend it on downloads. Upload what other students need to earn more.") + '</span>' +
            '<a class="btn-primary-sm" href="earn.html">See how to earn</a>' +
          '</div>' +
          (reqs.length ? reqs.map(function (q) {
            return '<a class="rw-card rw-card-req" href="upload.html?bounty=' + encodeURIComponent(q.id) + '">' +
              '<span class="rw-tag">Wanted</span><strong>' + escapeHtml(q.course) + ' ' + escapeHtml(q.type) + '</strong>' +
              '<span class="rw-sub">Earn ' + naira(q.reward) + ' when approved</span></a>';
          }).join("") : "");
        sec.style.display = "";
      }).catch(function () {});
  }
})();
