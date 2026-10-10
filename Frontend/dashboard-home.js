// ==========================================================================
// DASHBOARD HOME: the parts of the redesigned dashboard that drive action.
//   Loaded only on dashboard.html, after dashboard.js and incentives.js.
//   Everything here is additive and fails quietly: if an endpoint is
//   missing, that block hides and the rest of the page is unaffected.
//
//   1. Hero search (the primary action) with quick-search chips
//   2. Wallet panel (balance, add funds, rewards balance when live)
//   3. One smart "next step" nudge from wishlist + wallet state
//   4. "For your level" personalised row (GET /resources/recommended)
//   5. Upload prompt, swapped for the rewards strip when rewards are live
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  if (typeof currentUser === "undefined" || !currentUser) return;

  var $ = function (id) { return document.getElementById(id); };
  var naira = function (n) { return "\u20A6" + Math.round(Number(n) || 0).toLocaleString("en-NG"); };
  var json = function (path) { return authFetch(API_BASE + path).then(function (r) { return r.json(); }); };
  var RECENT_KEY = "sharef.recentSearches";
  var wallet = function () { return window.SharefWallet; };

  // ---- 1. Hero search -------------------------------------------------------
  function go(term) {
    term = (term || "").trim();
    if (!term) { $("dashSearchInput").focus(); return; }
    try {
      var list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter(function (t) { return t.toLowerCase() !== term.toLowerCase(); });
      list.unshift(term); localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (e) {}
    window.location.href = "resources.html?search=" + encodeURIComponent(term);
  }
  $("dashSearchForm").addEventListener("submit", function (e) { e.preventDefault(); go($("dashSearchInput").value); });

  function chip(term) { return '<a class="trend-chip" href="resources.html?search=' + encodeURIComponent(term) + '">' + escapeHtml(term) + "</a>"; }
  (function chips() {
    var recent = [];
    try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (e) {}
    if (recent.length) { $("dashChips").innerHTML = '<span class="dash-chips-label">Recent</span>' + recent.slice(0, 4).map(chip).join(""); return; }
    json("/resources/trending?limit=8").then(function (d) {
      if (!d.success) return;
      var seen = {}, courses = [];
      (d.resources || []).forEach(function (r) { if (r.course && !seen[r.course]) { seen[r.course] = 1; courses.push(r.course); } });
      if (courses.length) $("dashChips").innerHTML = '<span class="dash-chips-label">Popular</span>' + courses.slice(0, 4).map(chip).join("");
    }).catch(function () {});
  })();

  // ---- 2. Wallet panel ------------------------------------------------------
  var balance = null;
  function setWallet(b) {
    balance = b;
    $("dwBalance").textContent = naira(b);
    $("dwSub").textContent = b < 200 ? "Downloads start from \u20A6200. Add funds to get your first file." : "Ready to download.";
  }
  $("dwFund").addEventListener("click", function () { if (wallet()) wallet().openFundModal(); });
  var walletReady = wallet() && wallet().refreshBalance ? wallet().refreshBalance().then(function (b) { setWallet(Number(b) || 0); return Number(b) || 0; }) : Promise.resolve(null);

  // ---- 3. One smart next step ----------------------------------------------
  function nudge(html) { var el = $("dashNudge"); el.innerHTML = html; el.classList.remove("hidden"); }
  Promise.all([walletReady, json("/bookmarks").catch(function () { return { success: false }; })]).then(function (r) {
    var b = r[0], bm = r[1];
    if (b == null) return;
    var wanted = bm.success ? (bm.resources || []).filter(function (x) { return !x.owned; }) : [];
    if (wanted.length && wallet()) {
      var priced = wanted.map(function (x) { return { t: x.title, c: wallet().calculateCost(Number(x.pages) || 1) }; }).sort(function (x, y) { return x.c - y.c; });
      var canAfford = priced.filter(function (x) { return x.c <= b; }).length;
      if (canAfford) {
        nudge("<span><strong>" + canAfford + (canAfford === 1 ? " item" : " items") + " on your wishlist " + (canAfford === 1 ? "is" : "are") + " ready to get.</strong> Your balance covers " + (canAfford === 1 ? "it" : "them") + " now.</span><a class=\"btn-primary-sm\" href=\"bookmarks.html\">Open wishlist</a>");
      } else {
        nudge("<span><strong>Add " + naira(priced[0].c - b) + " to get \u201C" + escapeHtml(priced[0].t) + "\u201D</strong> from your wishlist.</span><button type=\"button\" class=\"btn-primary-sm\" id=\"nudgeFund\">Add funds</button>");
        var nf = $("nudgeFund"); if (nf) nf.addEventListener("click", function () { wallet().openFundModal(); });
      }
    }
  }).catch(function () {});

  // ---- 4. For your level ----------------------------------------------------
  json("/users/me").then(function (d) {
    var u = d.success ? d.user : null;
    if (!u) return;
    if (!u.level || !u.department) { $("forYouProfileCta").classList.remove("hidden"); return; }
    return json("/resources/recommended?limit=4").then(function (rec) {
      if (!rec.success || !(rec.resources || []).length || !window.__dashboardBuildCard) return;
      var grid = $("forYouGrid"); grid.innerHTML = "";
      rec.resources.forEach(function (r) {
        window.__dashboardResourceCache[r.id] = r;
        grid.appendChild(window.__dashboardBuildCard(r, { metricLabel: r.recentDownloads != null ? r.recentDownloads : "" }));
      });
      $("forYouTitle").textContent = "For " + u.level + (String(u.level).match(/level/i) ? "" : " Level") + " " + u.department;
      $("forYouSection").classList.remove("hidden");
    });
  }).catch(function () {});

  // ---- 5. Upload prompt vs rewards ------------------------------------------
  if (window.SharefRewards) {
    window.SharefRewards.loadConfig().then(function (cfg) {
      if (!window.SharefRewards.isVisible(cfg)) return;
      $("dashContribute").classList.add("hidden"); // the Earn Rewards strip replaces it
      window.SharefRewards.getJson("/incentives/me").then(function (me) {
        var r = me.balance && me.balance.reward;
        if (r) { var a = $("dwRewards"); a.textContent = naira(r) + " in rewards"; a.style.display = ""; }
      }).catch(function () {});
    }).catch(function () {});
  }
});
