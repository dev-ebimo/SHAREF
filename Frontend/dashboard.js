// Runs immediately (before DOMContentLoaded) — requireAuth() only touches
// localStorage, no DOM needed. Every section below bails out early if this
// is null, since requireAuth() has already redirected away in that case.
var currentUser = requireAuth();

document.addEventListener("DOMContentLoaded", function () {
  if (!currentUser) return;

  wireLogoutButton();

  var sidebar = document.getElementById("sidebar");
  var scrim = document.getElementById("scrim");
  var openBtn = document.getElementById("hamburgerBtn");
  var closeBtn = document.getElementById("sidebarCloseBtn");

  function openSidebar() {
    sidebar.classList.add("is-open");
    scrim.classList.add("is-visible");
    openBtn.setAttribute("aria-expanded", "true");
    closeBtn.focus();
    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    sidebar.classList.remove("is-open");
    scrim.classList.remove("is-visible");
    openBtn.setAttribute("aria-expanded", "false");
    openBtn.focus();
    document.body.style.overflow = "";
  }

  if (openBtn && closeBtn && scrim) {
    openBtn.addEventListener("click", openSidebar);
    closeBtn.addEventListener("click", closeSidebar);
    scrim.addEventListener("click", closeSidebar);
  }

  document.addEventListener("keydown", function (e) {
    if (
      e.key === "Escape" &&
      sidebar &&
      sidebar.classList.contains("is-open")
    ) {
      closeSidebar();
    }
  });

  window.addEventListener("resize", function () {
    if (
      window.innerWidth > 860 &&
      sidebar &&
      sidebar.classList.contains("is-open")
    ) {
      closeSidebar();
    }
  });

  // ==========================================================================
  // 2. RECENTLY ADDED + TRENDING — real data from the backend
  // ==========================================================================
  var recentFeedStack = document.getElementById("recentFeedStack");
  var feedMoreBtn = document.getElementById("feedMoreBtn");
  var trendingGrid = document.getElementById("trendingGrid");

  // Shared with section 7 (download modal) so it can look up a resource's
  // full data (id, pages, etc.) by whatever's rendered on screen, without
  // a second network call when a card/feed-item is clicked.
  window.__dashboardResourceCache = {};

  var FEED_ICON_SVG =
    '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>';

  function timeAgoLabel(isoDate) {
    var diffMs = Date.now() - new Date(isoDate).getTime();
    var mins = Math.floor(diffMs / 60000);
    var hours = Math.floor(diffMs / 3600000);
    var days = Math.floor(diffMs / 86400000);
    if (mins < 60) return mins <= 1 ? "Just now" : mins + " minutes ago";
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    if (days === 1) return "Yesterday";
    return days + " days ago";
  }

  function renderRecentFeed(resources) {
    if (!recentFeedStack) return;
    recentFeedStack.innerHTML = "";

    resources.forEach(function (resource, index) {
      window.__dashboardResourceCache[resource.id] = resource;

      var itemEl = document.createElement("div");
      itemEl.className = "feed-item" + (index >= 2 ? " hidden" : "");
      itemEl.dataset.resourceId = resource.id;
      itemEl.innerHTML =
        '<div class="item-info">' +
        "<h3>" + resource.title + "</h3>" +
        "<p>Added " + timeAgoLabel(resource.date) + " • " + resource.type + "</p>" +
        "</div>" +
        '<div class="item-control-links">' +
        '<a href="#" class="feed-inline-link" data-action="download">Download</a>' +
        '<a href="#" class="feed-inline-link" data-action="preview">Preview</a>' +
        "</div>";
      recentFeedStack.appendChild(itemEl);
    });

    if (feedMoreBtn) {
      feedMoreBtn.style.display = resources.length > 2 ? "" : "none";
    }
  }

  function renderTrending(resources) {
    if (!trendingGrid) return;
    trendingGrid.innerHTML = "";

    resources.forEach(function (resource) {
      window.__dashboardResourceCache[resource.id] = resource;

      var card = document.createElement("article");
      card.className = "resource-card";
      card.dataset.resourceId = resource.id;
      card.innerHTML =
        '<div class="card-top-meta">' +
        '<span class="type-tag pdf-type">' + resource.type + "</span>" +
        '<button class="icon-btn-badge" style="padding: 0.2rem" aria-label="Bookmark this resource" data-action="bookmark">' +
        '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L7 21V5z"/></svg>' +
        "</button>" +
        "</div>" +
        '<div class="card-body-zone">' +
        "<h3>" + resource.title + "</h3>" +
        '<span class="course-code-sub">' + resource.course + "</span>" +
        "</div>" +
        '<div class="card-bottom-metrics">' +
        '<div class="metric-node">' +
        '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>' +
        "<span>" + resource.recentDownloads + "</span>" +
        "</div>" +
        "</div>";
      trendingGrid.appendChild(card);
    });
  }

  if (recentFeedStack) {
    authFetch(API_BASE + "/resources/recent?limit=10")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) renderRecentFeed(data.resources);
      })
      .catch(function (err) { console.error("Could not load recent resources:", err); });
  }

  if (trendingGrid) {
    authFetch(API_BASE + "/resources/trending?limit=6")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) renderTrending(data.resources);
      })
      .catch(function (err) { console.error("Could not load trending resources:", err); });
  }

  // ------------------------------------------------------------------
  // Continue Learning — real data, no fake "% read" (that was never a
  // real tracked feature). "Continue" just re-opens the same download
  // modal used everywhere else, since re-downloads are free.
  // ------------------------------------------------------------------
  var continueSection = document.getElementById("continueLearningSection");
  var continueContainer = document.getElementById("continueLearningContainer");

  function renderContinueLearning(resources) {
    if (!continueContainer) return;

    if (resources.length === 0) {
      if (continueSection) continueSection.style.display = "none";
      return;
    }
    if (continueSection) continueSection.style.display = "";

    continueContainer.innerHTML = "";
    var resource = resources[0]; // most recently downloaded
    window.__dashboardResourceCache[resource.id] = resource;

    var card = document.createElement("button");
    card.type = "button";
    card.className = "continue-card";
    card.dataset.resourceId = resource.id;
    card.innerHTML =
      '<div class="continue-meta">' +
      '<div class="continue-progress-ring" aria-hidden="true"></div>' +
      "<div><h3>" + resource.title + "</h3><p>" + resource.course + " • " + resource.type + "</p></div>" +
      "</div>" +
      '<span class="continue-action">Continue' +
      '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>' +
      "</span>";
    continueContainer.appendChild(card);
  }

  authFetch(API_BASE + "/resources/continue-learning?limit=1")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.success) renderContinueLearning(data.resources);
    })
    .catch(function (err) { console.error("Could not load continue learning:", err); });

  // Toggle logic for showing hidden feed items — unchanged from before,
  // still just operates on whatever .feed-item elements exist at click time.
  if (feedMoreBtn) {
    feedMoreBtn.addEventListener("click", function () {
      var hiddenItems = recentFeedStack.querySelectorAll(".feed-item.hidden");
      var allItems = recentFeedStack.querySelectorAll(".feed-item");
      var labelSpan = feedMoreBtn.querySelector("span");

      if (hiddenItems.length > 0) {
        hiddenItems.forEach(function (el) {
          el.classList.remove("hidden");
        });
        labelSpan.textContent = "See less updates";
        feedMoreBtn.classList.add("expanded");
      } else {
        allItems.forEach(function (el, index) {
          if (index >= 2) el.classList.add("hidden");
        });
        labelSpan.textContent = "See more updates";
        feedMoreBtn.classList.remove("expanded");
      }
    });
  }
});
// ==========================================================================
// 3. INTELLIGENT SEARCH OMNIBAR CONTROLS
// ==========================================================================
var searchWrapper = document.getElementById("searchWrapper");
var omnibarInput = document.getElementById("omnibarInput");
var searchDropdown = document.getElementById("searchDropdown");
var stateDefault = document.getElementById("searchStateDefault");
var stateResults = document.getElementById("searchStateResults");

if (omnibarInput && searchWrapper) {
  // Expand dropdown interface on focus
  omnibarInput.addEventListener("focus", function () {
    searchWrapper.classList.add("is-focused");
    searchDropdown.setAttribute("aria-hidden", "false");
  });

  // Track key up sequences inside the input bar
  omnibarInput.addEventListener("input", function (e) {
    var value = e.target.value.trim();

    if (value.length > 0) {
      // If user typed context, change view state to Filtered Suggestions
      stateDefault.classList.add("hidden");
      stateResults.classList.remove("hidden");
    } else {
      // Retract view to standard Discovery metrics
      stateDefault.classList.remove("hidden");
      stateResults.classList.add("hidden");
    }
  });

  // Close dropdown safely when clicking completely outside the element tree
  document.addEventListener("click", function (event) {
    var isClickInside = searchWrapper.contains(event.target);

    if (!isClickInside) {
      searchWrapper.classList.remove("is-focused");
      searchDropdown.setAttribute("aria-hidden", "true");
    }
  });

  // Handle Escape vector shortcuts
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && searchWrapper.classList.contains("is-focused")) {
      omnibarInput.blur();
      searchWrapper.classList.remove("is-focused");
      searchDropdown.setAttribute("aria-hidden", "true");
    }
  });
}

// ==========================================================================
// 4. MOBILE-ONLY SEARCH TOGGLE
//    Below the 860px breakpoint the search bar collapses into an icon in
//    the top nav. Tapping it expands the same search-wrapper (input +
//    dropdown) to fill the bar, in place of the logo/hamburger/nav-actions.
// ==========================================================================
var mobileSearchTrigger = document.getElementById("mobileSearchTrigger");
var mobileSearchCloseBtn = document.getElementById("mobileSearchCloseBtn");
var topNav = document.querySelector(".top-nav");

if (mobileSearchTrigger && mobileSearchCloseBtn && topNav && searchWrapper) {
  function openMobileSearch() {
    topNav.classList.add("mobile-search-active");
    mobileSearchTrigger.setAttribute("aria-expanded", "true");
    // Wait a tick so the bar has finished expanding before focusing —
    // avoids a layout jump on some mobile browsers.
    requestAnimationFrame(function () {
      if (omnibarInput) omnibarInput.focus();
    });
  }

  function closeMobileSearch() {
    topNav.classList.remove("mobile-search-active");
    mobileSearchTrigger.setAttribute("aria-expanded", "false");
    if (omnibarInput) {
      omnibarInput.value = "";
      omnibarInput.blur();
    }
    searchWrapper.classList.remove("is-focused");
    if (searchDropdown) searchDropdown.setAttribute("aria-hidden", "true");
    if (stateDefault) stateDefault.classList.remove("hidden");
    if (stateResults) stateResults.classList.add("hidden");
    mobileSearchTrigger.focus();
  }

  mobileSearchTrigger.addEventListener("click", openMobileSearch);
  mobileSearchCloseBtn.addEventListener("click", closeMobileSearch);

  document.addEventListener("keydown", function (e) {
    if (
      e.key === "Escape" &&
      topNav.classList.contains("mobile-search-active")
    ) {
      closeMobileSearch();
    }
  });

  // If the viewport grows past mobile size, reset back to the desktop layout
  window.addEventListener("resize", function () {
    if (
      window.innerWidth > 860 &&
      topNav.classList.contains("mobile-search-active")
    ) {
      closeMobileSearch();
    }
  });
}

// ==========================================================================
// 5. ACCOUNT MENU (avatar dropdown)
//    Shared across every page that includes this file — dashboard, profile,
//    and any future page that has the top nav.
// ==========================================================================
var accountMenuWrapper = document.getElementById("accountMenuWrapper");
var accountMenuTrigger = document.getElementById("accountMenuTrigger");
var accountMenuPanel = document.getElementById("accountMenuPanel");

if (accountMenuWrapper && accountMenuTrigger && accountMenuPanel) {
  function openAccountMenu() {
    accountMenuWrapper.classList.add("is-open");
    accountMenuTrigger.setAttribute("aria-expanded", "true");
    accountMenuPanel.setAttribute("aria-hidden", "false");
  }

  function closeAccountMenu() {
    accountMenuWrapper.classList.remove("is-open");
    accountMenuTrigger.setAttribute("aria-expanded", "false");
    accountMenuPanel.setAttribute("aria-hidden", "true");
  }

  accountMenuTrigger.addEventListener("click", function (e) {
    e.stopPropagation();
    if (accountMenuWrapper.classList.contains("is-open")) {
      closeAccountMenu();
    } else {
      openAccountMenu();
    }
  });

  // Close on outside click
  document.addEventListener("click", function (event) {
    if (!accountMenuWrapper.contains(event.target)) {
      closeAccountMenu();
    }
  });

  // Close on Escape, return focus to the trigger
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && accountMenuWrapper.classList.contains("is-open")) {
      closeAccountMenu();
      accountMenuTrigger.focus();
    }
  });

  // Demo-only: the Log Out item has no real destination yet
  var logoutItem = accountMenuPanel.querySelector(".account-logout-item");
  if (logoutItem) {
    logoutItem.addEventListener("click", function () {
      closeAccountMenu();
    });
  }
}
// PROFILE PAGE EXTENSION: KEBAB DROPDOWN CONTROLS
document.addEventListener("click", function (event) {
  // Capture clicks on the kebab trigger specifically
  var kebabWrapper = event.target.closest('.kebab-menu-wrapper');
  
  // Close all other open kebab dropdowns first
  document.querySelectorAll('.kebab-menu-wrapper.is-open').forEach(function (openMenu) {
    if (openMenu !== kebabWrapper) {
      openMenu.classList.remove('is-open');
    }
  });

  // If clicking an active button, toggle its respective panel layout
  if (kebabWrapper && event.target.closest('.kebab-btn')) {
    event.stopPropagation();
    kebabWrapper.classList.toggle('is-open');
  }
});
// ==========================================================================
// 6. STUDY WALLET — real backend-backed payment system
//    Runs on every page that loads dashboard.js. Injects a wallet balance
//    chip into the nav, plus a Fund Wallet modal and an Insufficient
//    Balance modal (both built once and appended to <body>, so no page's
//    HTML needs to be touched). Resource pages call window.SharefWallet
//    instead of touching the API directly.
//
//    The backend is always the source of truth for balance and cost —
//    this file never decides whether a charge succeeds, it only displays
//    what the server tells it and reacts to the response.
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  if (!currentUser) return;

  var MIN_FUND = 100;
  var chipAmountEl = null;
  var cachedBalance = 0;

  function formatNaira(amount) {
    return "₦" + Math.round(amount).toLocaleString("en-NG");
  }

  function updateChipDisplay(balance) {
    cachedBalance = balance;
    if (chipAmountEl) chipAmountEl.textContent = formatNaira(balance);
  }

  function fetchBalance() {
    return authFetch(API_BASE + "/wallet/balance")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) updateChipDisplay(data.balance);
        return data.success ? data.balance : cachedBalance;
      })
      .catch(function (err) {
        console.error("Could not fetch wallet balance:", err);
        return cachedBalance;
      });
  }

  // ------------------------------------------------------------------
  // Wallet chip (nav)
  // ------------------------------------------------------------------
  var navActions = document.querySelector(".nav-actions");
  var accountWrapper = document.getElementById("accountMenuWrapper");

  if (navActions) {
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "wallet-chip";
    chip.id = "walletChip";
    chip.setAttribute("aria-haspopup", "dialog");
    chip.setAttribute("aria-label", "Study wallet balance, click to fund");
    chip.innerHTML =
      '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
      '<path d="M20 7H6a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2zM16 5H4a2 2 0 00-2 2v9" />' +
      '<circle cx="16.5" cy="13.5" r="1.1" fill="currentColor" stroke="none" />' +
      "</svg>" +
      "<span id=\"walletChipAmount\">…</span>";

    if (accountWrapper && accountWrapper.parentNode === navActions) {
      navActions.insertBefore(chip, accountWrapper);
    } else {
      navActions.appendChild(chip);
    }

    chipAmountEl = chip.querySelector("#walletChipAmount");
    fetchBalance();

    chip.addEventListener("click", function () {
      openFundModal();
    });
  }

  // ------------------------------------------------------------------
  // Shared confirmation toast
  // ------------------------------------------------------------------
  var toastEl = document.createElement("div");
  toastEl.className = "wallet-toast";
  toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  var toastTimer = null;

  function showWalletToast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-visible");
    }, 2800);
  }

  // ------------------------------------------------------------------
  // Fund Wallet modal — now redirects to Paystack's real checkout
  // ------------------------------------------------------------------
  var fundOverlay = document.createElement("div");
  fundOverlay.className = "wallet-modal-overlay";
  fundOverlay.innerHTML =
    '<div class="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="fundModalTitle">' +
    '<button type="button" class="wallet-modal-close-btn" id="fundModalCloseBtn" aria-label="Close">' +
    '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>' +
    "</button>" +
    '<div id="fundModalBody"></div>' +
    "</div>";
  document.body.appendChild(fundOverlay);

  var fundModalBody = fundOverlay.querySelector("#fundModalBody");
  var fundModalCloseBtn = fundOverlay.querySelector("#fundModalCloseBtn");

  function renderFundForm() {
    fundModalBody.innerHTML =
      '<h3 class="wallet-modal-title" id="fundModalTitle">Fund Study Wallet</h3>' +
      '<div class="wallet-balance-row"><span>Current Balance</span><strong>' +
      formatNaira(cachedBalance) +
      "</strong></div>" +
      '<label class="wallet-field-label" for="fundAmountInput">Amount</label>' +
      '<input type="number" id="fundAmountInput" class="wallet-amount-input" placeholder="Enter amount" min="' +
      MIN_FUND +
      '" step="50" />' +
      '<p class="wallet-hint">Minimum: ' + formatNaira(MIN_FUND) + "</p>" +
      '<p class="wallet-field-error" id="fundAmountError"></p>' +
      '<div class="wallet-modal-actions">' +
      '<button type="button" class="btn-wallet-primary" id="fundContinueBtn">Continue Payment</button>' +
      "</div>";

    var input = fundModalBody.querySelector("#fundAmountInput");
    var errorEl = fundModalBody.querySelector("#fundAmountError");
    var continueBtn = fundModalBody.querySelector("#fundContinueBtn");

    continueBtn.addEventListener("click", function () {
      var amount = Number(input.value);

      if (!amount || amount < MIN_FUND) {
        errorEl.textContent = "Enter at least " + formatNaira(MIN_FUND) + ".";
        return;
      }

      errorEl.textContent = "";
      continueBtn.disabled = true;
      continueBtn.textContent = "Redirecting to Paystack...";

      authFetch(API_BASE + "/wallet/fund/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amount }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.success) {
            errorEl.textContent = data.message || "Could not start payment. Please try again.";
            continueBtn.disabled = false;
            continueBtn.textContent = "Continue Payment";
            return;
          }
          // Hand off to Paystack's hosted checkout — the browser leaves
          // this page entirely and comes back via payment-callback.html
          window.location.href = data.authorizationUrl;
        })
        .catch(function (err) {
          errorEl.textContent = "Network error — could not reach the server.";
          continueBtn.disabled = false;
          continueBtn.textContent = "Continue Payment";
          console.error(err);
        });
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") continueBtn.click();
    });
  }

  function openFundModal() {
    renderFundForm();
    fundOverlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
    var input = fundModalBody.querySelector("#fundAmountInput");
    if (input) input.focus();
  }

  function closeFundModal() {
    fundOverlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  fundModalCloseBtn.addEventListener("click", closeFundModal);
  fundOverlay.addEventListener("click", function (e) {
    if (e.target === fundOverlay) closeFundModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && fundOverlay.classList.contains("is-open")) closeFundModal();
  });

  // ------------------------------------------------------------------
  // Insufficient Balance modal — now populated from the server's 402
  // response instead of a client-side balance check
  // ------------------------------------------------------------------
  var insufficientOverlay = document.createElement("div");
  insufficientOverlay.className = "wallet-modal-overlay";
  insufficientOverlay.innerHTML =
    '<div class="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="insufficientModalTitle">' +
    '<button type="button" class="wallet-modal-close-btn" id="insufficientCloseBtn" aria-label="Close">' +
    '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>' +
    "</button>" +
    '<h3 class="wallet-modal-title" id="insufficientModalTitle">Insufficient Balance</h3>' +
    '<div class="wallet-insufficient-stats">' +
    "<div><span>This resource costs</span><strong id=\"insufficientCost\"></strong></div>" +
    "<div><span>Your balance is</span><strong id=\"insufficientBalance\"></strong></div>" +
    "</div>" +
    '<div class="wallet-modal-actions">' +
    '<button type="button" class="btn-wallet-secondary" id="insufficientCancelBtn">Cancel</button>' +
    '<button type="button" class="btn-wallet-primary" id="insufficientFundBtn">Fund Wallet</button>' +
    "</div>" +
    "</div>";
  document.body.appendChild(insufficientOverlay);

  var insufficientCloseBtn = insufficientOverlay.querySelector("#insufficientCloseBtn");
  var insufficientCancelBtn = insufficientOverlay.querySelector("#insufficientCancelBtn");
  var insufficientFundBtn = insufficientOverlay.querySelector("#insufficientFundBtn");
  var insufficientCostEl = insufficientOverlay.querySelector("#insufficientCost");
  var insufficientBalanceEl = insufficientOverlay.querySelector("#insufficientBalance");

  function openInsufficientModal(cost, balance) {
    insufficientCostEl.textContent = formatNaira(cost);
    insufficientBalanceEl.textContent = formatNaira(balance);
    insufficientOverlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
    insufficientCloseBtn.focus();
  }

  function closeInsufficientModal() {
    insufficientOverlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  insufficientCloseBtn.addEventListener("click", closeInsufficientModal);
  insufficientCancelBtn.addEventListener("click", closeInsufficientModal);
  insufficientOverlay.addEventListener("click", function (e) {
    if (e.target === insufficientOverlay) closeInsufficientModal();
  });
  insufficientFundBtn.addEventListener("click", function () {
    closeInsufficientModal();
    openFundModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && insufficientOverlay.classList.contains("is-open")) {
      closeInsufficientModal();
    }
  });

  // ------------------------------------------------------------------
  // Public API for resource pages
  // ------------------------------------------------------------------
  window.SharefWallet = {
    formatNaira: formatNaira,
    showToast: showWalletToast,
    openFundModal: openFundModal,
    refreshBalance: fetchBalance,

    // Charges for a resource by id — the backend computes the real cost
    // from the resource's page count, never trusts a client-supplied
    // amount. Returns a Promise resolving to the server's response object
    // ({ success, alreadyOwned, fileUrl, ... } or { success:false,
    // insufficientBalance:true, ... }), so callers must use .then()/await
    // instead of treating this as an instant synchronous result.
    charge: function (resourceId, description) {
      return authFetch(API_BASE + "/wallet/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: resourceId }),
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (result) {
          var data = result.data;

          if (!data.success) {
            if (data.insufficientBalance) {
              openInsufficientModal(data.required, data.currentBalance);
            } else {
              showWalletToast(data.message || "Could not process download.");
            }
            return data;
          }

          if (typeof data.newBalance === "number") updateChipDisplay(data.newBalance);
          return data;
        })
        .catch(function (err) {
          showWalletToast("Network error — could not process download.");
          console.error(err);
          return { success: false };
        });
    },
  };
});

// ==========================================================================
// 7. RESOURCE DOWNLOAD MODAL — payment popup for the dashboard
//    (Recently Added feed + Trending resource cards). Resource data comes
//    from window.__dashboardResourceCache, populated by section 2's
//    fetch of /api/resources/recent and /trending — both already return
//    everything this modal needs (course, type, size, pages, downloads),
//    so no second network call is needed just to open it.
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  if (!currentUser) return;
  if (!window.SharefWallet) return; // section 6 should always run first, but stay safe

  // ------------------------------------------------------------------
  // Modal markup — built once and appended to <body>, same pattern as
  // the Fund/Insufficient wallet modals in section 6 (no HTML edits).
  // ------------------------------------------------------------------
  var downloadOverlay = document.createElement("div");
  downloadOverlay.className = "wallet-modal-overlay";
  downloadOverlay.innerHTML =
    '<div class="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="downloadModalTitle">' +
    '<button type="button" class="wallet-modal-close-btn" id="downloadModalCloseBtn" aria-label="Close">' +
    '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>' +
    "</button>" +
    '<div class="download-modal-header">' +
    '<span class="download-modal-tag" id="downloadModalTag">Resource</span>' +
    '<h3 id="downloadModalTitle">Title</h3>' +
    '<p class="download-modal-meta" id="downloadModalMeta"></p>' +
    "</div>" +
    '<div class="download-stats-grid">' +
    '<div class="stat-item"><span class="label">Size</span><span class="val" id="downloadModalSize"></span></div>' +
    '<div class="stat-item"><span class="label">Pages</span><span class="val" id="downloadModalPages"></span></div>' +
    '<div class="stat-item"><span class="label">Downloads</span><span class="val" id="downloadModalDownloads"></span></div>' +
    '<div class="stat-item price-stat"><span class="label">Price</span><span class="val" id="downloadModalPrice"></span></div>' +
    "</div>" +
    '<p class="wallet-hint" id="downloadModalPreview">Loading preview…</p>' +
    '<div class="wallet-modal-actions">' +
    '<button type="button" class="btn-wallet-secondary" id="downloadModalCancelBtn">Cancel</button>' +
    '<button type="button" class="btn-wallet-primary" id="downloadModalConfirmBtn">Download File</button>' +
    "</div>" +
    "</div>";
  document.body.appendChild(downloadOverlay);

  var downloadCloseBtn = downloadOverlay.querySelector("#downloadModalCloseBtn");
  var downloadCancelBtn = downloadOverlay.querySelector("#downloadModalCancelBtn");
  var downloadConfirmBtn = downloadOverlay.querySelector("#downloadModalConfirmBtn");
  var downloadTagEl = downloadOverlay.querySelector("#downloadModalTag");
  var downloadTitleEl = downloadOverlay.querySelector("#downloadModalTitle");
  var downloadMetaEl = downloadOverlay.querySelector("#downloadModalMeta");
  var downloadSizeEl = downloadOverlay.querySelector("#downloadModalSize");
  var downloadPagesEl = downloadOverlay.querySelector("#downloadModalPages");
  var downloadDownloadsEl = downloadOverlay.querySelector("#downloadModalDownloads");
  var downloadPriceEl = downloadOverlay.querySelector("#downloadModalPrice");
  var downloadPreviewEl = downloadOverlay.querySelector("#downloadModalPreview");
  var DOWNLOAD_BTN_DEFAULT_TEXT = "Download File";

  var currentResource = null;

  // The real per-bracket formula, mirrored here purely for display before
  // the user confirms — the backend recomputes this independently from
  // the resource's actual page count and is the only source that matters
  // for what actually gets charged.
  function calculateResourceCost(pages) {
    if (pages <= 5) return 200;
    if (pages <= 24) return 200 + (pages - 5) * 20;
    return 580 + (pages - 24) * 10;
  }

  function openDownloadModal(resource) {
    currentResource = resource;
    var cost = calculateResourceCost(resource.pages);

    downloadTagEl.textContent = resource.type || "Resource";
    downloadTitleEl.textContent = resource.title;
    downloadMetaEl.textContent = resource.course || "";
    downloadSizeEl.textContent = resource.size;
    downloadPagesEl.textContent = resource.pages + " Pages";
    downloadDownloadsEl.textContent = resource.downloads;
    downloadPriceEl.textContent = window.SharefWallet.formatNaira(cost);
    downloadConfirmBtn.textContent = "Download File · " + window.SharefWallet.formatNaira(cost);
    downloadConfirmBtn.disabled = false;
    downloadPreviewEl.textContent = "Loading preview…";

    downloadOverlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
    downloadCloseBtn.focus();

    authFetch(API_BASE + "/resources/" + resource.id + "/preview")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (currentResource !== resource) return; // modal moved on to something else
        downloadPreviewEl.textContent = data.available
          ? '"' + data.snippet + '"'
          : (data.message || "Preview not available for this file type.");
      })
      .catch(function () {
        downloadPreviewEl.textContent = "Preview not available right now.";
      });
  }

  function closeDownloadModal() {
    downloadOverlay.classList.remove("is-open");
    document.body.style.overflow = "";
    currentResource = null;
    downloadConfirmBtn.textContent = DOWNLOAD_BTN_DEFAULT_TEXT;
  }

  downloadCloseBtn.addEventListener("click", closeDownloadModal);
  downloadCancelBtn.addEventListener("click", closeDownloadModal);
  downloadOverlay.addEventListener("click", function (e) {
    if (e.target === downloadOverlay) closeDownloadModal();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && downloadOverlay.classList.contains("is-open")) {
      closeDownloadModal();
    }
  });

  downloadConfirmBtn.addEventListener("click", function () {
    if (!currentResource) return;
    var resource = currentResource;

    downloadConfirmBtn.disabled = true;
    downloadConfirmBtn.textContent = "Processing...";

    window.SharefWallet.charge(resource.id, resource.course + " — " + resource.title).then(function (data) {
      downloadConfirmBtn.disabled = false;

      if (!data.success) {
        // Insufficient-balance case already opened its own modal inside
        // charge() — just restore this modal's button text and stop here.
        downloadConfirmBtn.textContent = DOWNLOAD_BTN_DEFAULT_TEXT;
        return;
      }

      if (data.fileUrl) window.open(data.fileUrl, "_blank");

      window.SharefWallet.showToast(
        data.alreadyOwned
          ? '"' + resource.title + '" download started.'
          : window.SharefWallet.formatNaira(data.amountCharged) + ' deducted · "' + resource.title + '" download started.'
      );
      closeDownloadModal();
    });
  });

  // ------------------------------------------------------------------
  // Triggers: "Download" / "Preview" links in Recently Added, and the
  // Trending resource cards — both look up the real resource by id from
  // the shared cache populated in section 2.
  // ------------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var feedLink = e.target.closest(".feed-inline-link");
    if (feedLink) {
      e.preventDefault();
      var feedItem = feedLink.closest(".feed-item");
      var feedId = feedItem && feedItem.dataset.resourceId;
      var feedResource = feedId && window.__dashboardResourceCache[feedId];
      if (feedResource) openDownloadModal(feedResource);
      return;
    }

    var continueCard = e.target.closest(".continue-card");
    if (continueCard) {
      var continueId = continueCard.dataset.resourceId;
      var continueResource = continueId && window.__dashboardResourceCache[continueId];
      if (continueResource) openDownloadModal(continueResource);
      return;
    }

    var card = e.target.closest(".resource-card");
    if (card && !e.target.closest(".icon-btn-badge")) {
      var cardId = card.dataset.resourceId;
      var cardResource = cardId && window.__dashboardResourceCache[cardId];
      if (cardResource) openDownloadModal(cardResource);
    }
  });
});
