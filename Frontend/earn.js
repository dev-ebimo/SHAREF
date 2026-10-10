// Student "Earn Rewards" page. Display only — the backend decides every
// amount, cap and payout (see INCENTIVES_INTEGRATION.md for the contract).
document.addEventListener("DOMContentLoaded", function () {
  if (typeof currentUser === "undefined" || !currentUser) return;
  if (currentUser.role === "admin") { window.location.href = resolveLandingPage(currentUser); return; }

  var R = window.SharefRewards, naira = R.naira;
  var $ = function (id) { return document.getElementById(id); };
  var stateEl = $("rwState"), content = $("rwContent"), banner = $("rwBanner");

  function say(msg) { stateEl.textContent = msg; stateEl.classList.remove("hidden"); content.classList.add("hidden"); }

  R.loadConfig(true).then(function (cfg) {
    if (!R.isVisible(cfg)) return say("Rewards are not open yet. We will announce it here when they start.");
    return R.getJson("/incentives/me").then(function (me) { render(cfg, me); });
  }).catch(function () { say("Rewards are not available right now. Try again later."); });

  function render(cfg, me) {
    var b = me.balance || {};
    stateEl.classList.add("hidden"); content.classList.remove("hidden");

    var msgs = [];
    if (cfg.status === "paused") msgs.push("Rewards are paused. You can keep uploading, but new rewards are on hold until the program resumes.");
    if (me.frozen) msgs.push("Your rewards are on hold while we review your account. Contact support from the Help page if you think this is a mistake.");
    if (cfg.season && cfg.season.endsAt) {
      var days = Math.ceil((new Date(cfg.season.endsAt) - Date.now()) / 864e5);
      if (days > 0) msgs.push((cfg.season.name || "Contribution season") + " ends in " + days + (days === 1 ? " day." : " days."));
    }
    if (msgs.length) { banner.textContent = msgs.join(" "); banner.classList.remove("hidden"); }

    $("rwReward").textContent = naira(b.reward);
    $("rwRewardSub").textContent = "Spent first when you download. It can pay for a whole download.";
    $("rwFunded").textContent = naira(b.funded);
    $("rwPending").textContent = naira(b.pending);
    $("rwPendingSub").textContent = cfg.holdDays ? "New rewards become spendable after " + cfg.holdDays + (cfg.holdDays === 1 ? " day." : " days.") : "";
    $("rwHoldRule").textContent = cfg.holdDays ? "New rewards clear after " + cfg.holdDays + " days so we can catch mistakes first." : "";

    var cap = me.weekCap || cfg.weeklyCap || 0, earned = me.weekEarned || 0;
    $("rwCapText").textContent = naira(earned) + (cap ? " of " + naira(cap) : "");
    $("rwCapBar").style.width = cap ? Math.min(100, earned / cap * 100) + "%" : "0%";

    var rw = cfg.rewards || {};
    var how = [
      ["Past question", rw.pastQuestion, "A complete, readable past question for a course we need."],
      ["Lecture note", rw.lectureNote, "Clear notes that match a real course and level."],
      ["Your first approved upload", rw.firstApproval, "A one-time bonus on top of the normal reward."],
      ["A friend who contributes", rw.referralFirstApproval, "Paid after your friend's first upload is approved."]
    ].filter(function (h) { return h[1]; });
    $("rwHow").innerHTML = how.map(function (h) {
      return '<div class="rw-card"><span class="rw-label">' + escapeHtml(h[0]) + '</span><strong class="rw-big rw-big-sm">' + naira(h[1]) + '</strong><span class="rw-sub">' + escapeHtml(h[2]) + '</span></div>';
    }).join("");

    var ch = me.challenge;
    if (ch && ch.need) {
      var pct = Math.min(100, (ch.done || 0) / ch.need * 100);
      $("rwChallenge").innerHTML = '<strong>' + escapeHtml(ch.title || "Weekly challenge") + '</strong><div class="rw-meter"><i style="width:' + pct + '%"></i></div><span class="rw-sub">' + (ch.done || 0) + ' of ' + ch.need + ' approved · bonus ' + naira(ch.reward) + '</span>';
    } else $("rwChallengeSection").classList.add("hidden");

    renderReferral(cfg, me);
    renderLedger(me.ledger || []);
    R.getJson("/incentives/requests").then(renderRequests).catch(function () { $("rwRequestsSection").classList.add("hidden"); });
    R.getJson("/incentives/leaderboard").then(renderBoard).catch(function () { $("rwBoard").innerHTML = '<li class="rw-empty">Leaderboard unavailable.</li>'; });
  }

  function empty(msg) { return '<div class="rw-empty">' + escapeHtml(msg) + "</div>"; }

  function renderRequests(d) {
    var list = d.requests || [];
    $("rwRequests").innerHTML = list.length ? list.map(function (q) {
      return '<div class="rw-row"><div><strong>' + escapeHtml(q.course) + " " + escapeHtml(q.type) + '</strong>' +
        '<span class="rw-sub">' + escapeHtml([q.level, q.note].filter(Boolean).join(" · ")) + '</span></div>' +
        '<div class="rw-row-end"><span class="rw-amt">' + naira(q.reward) + '</span>' +
        '<a class="btn-primary-sm" href="upload.html?bounty=' + encodeURIComponent(q.id) + '">I have this</a></div></div>';
    }).join("") : empty("Nothing is wanted right now. You can still upload any course material that is missing.");
  }

  function renderReferral(cfg, me) {
    var rw = cfg.rewards || {};
    var link = location.origin + location.pathname.replace(/[^/]*$/, "") + "signup.html?ref=" + encodeURIComponent(me.referralCode || "");
    $("rwRefCopy").textContent = rw.referralFirstApproval
      ? "You earn " + naira(rw.referralFirstApproval) + " after a friend you invite verifies their account and gets their first upload approved. Signing up alone does not pay."
      : "Share your link with classmates.";
    $("rwRefLink").value = me.referralCode ? link : "";
    $("rwCopyBtn").disabled = !me.referralCode;
    $("rwCopyBtn").onclick = function () {
      var inp = $("rwRefLink"); inp.select();
      (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).catch(function () { document.execCommand("copy"); });
      $("rwCopyBtn").textContent = "Copied";
      setTimeout(function () { $("rwCopyBtn").textContent = "Copy link"; }, 1800);
    };
    var labels = { signed_up: "Signed up", verified: "Verified", contributed: "First upload approved" };
    var refs = me.referrals || [];
    $("rwReferrals").innerHTML = refs.length ? refs.map(function (r) {
      return '<div class="rw-row"><div><strong>' + escapeHtml(r.name) + '</strong><span class="rw-sub">' + escapeHtml(labels[r.status] || r.status) + '</span></div>' +
        '<span class="rw-amt">' + (r.earned ? "+" + naira(r.earned) : "—") + '</span></div>';
    }).join("") : "";
  }

  function renderBoard(d) {
    var l = d.leaders || [];
    $("rwBoard").innerHTML = l.length ? l.map(function (p) {
      return '<li class="' + (p.isMe ? "is-me" : "") + '"><span>' + escapeHtml(p.name) + (p.isMe ? " (you)" : "") + '</span><strong>' + p.approved + ' approved</strong></li>';
    }).join("") : '<li class="rw-empty">No approved uploads this week yet. Be the first.</li>';
  }

  function renderLedger(items) {
    var tag = { pending: "Clearing", cleared: "Available", reversed: "Taken back" };
    $("rwLedger").innerHTML = items.length ? items.map(function (e) {
      return '<div class="rw-row"><div><strong>' + escapeHtml(e.label) + '</strong><span class="rw-sub">' + escapeHtml(new Date(e.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })) + '</span></div>' +
        '<div class="rw-row-end"><span class="rw-chip rw-' + escapeHtml(e.status) + '">' + escapeHtml(tag[e.status] || e.status) + '</span><span class="rw-amt ' + (e.amount < 0 ? "neg" : "") + '">' + (e.amount < 0 ? "−" : "+") + naira(Math.abs(e.amount)) + '</span></div></div>';
    }).join("") : empty("No rewards yet. Your first approved upload will show up here.");
  }
});
