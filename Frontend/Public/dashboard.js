document.addEventListener("DOMContentLoaded", function () {
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
  // 2. DYNAMIC MOCK CONTENTS & FEED TOGGLE ("SEE MORE")
  // ==========================================================================
  var recentFeedStack = document.getElementById("recentFeedStack");
  var feedMoreBtn = document.getElementById("feedMoreBtn");

  // Simulated hidden elements to preserve visual clarity on load
  var additionalItems = [
    {
      title: "CSC 204 Computer Architecture Notes",
      meta: "Added 5 days ago • PDF Document",
    },
    {
      title: "MTH 202 Differential Equations Guide",
      meta: "Added 1 week ago • Text File",
    },
  ];

  // Only run this on pages that actually have the feed (i.e. the dashboard) —
  // without this guard, calling appendChild on a null recentFeedStack throws
  // on every other page, which silently stops the rest of this handler
  // (including the search/hamburger wiring further down) from running.
  if (recentFeedStack) {
    // Inject hidden secondary nodes into layout stack
    additionalItems.forEach(function (item) {
      var itemEl = document.createElement("div");
      itemEl.className = "feed-item hidden";
      itemEl.innerHTML = `
            <div class="item-info">
                <h3>${item.title}</h3>
                <p>${item.meta}</p>
            </div>
            <div class="item-control-links">
                <a href="#" class="feed-inline-link">Download</a>
                <a href="#" class="feed-inline-link">Preview</a>
            </div>
        `;
      recentFeedStack.appendChild(itemEl);
    });
  }

  // Toggle logic for showing hidden items cleanly
  if (feedMoreBtn) {
    feedMoreBtn.addEventListener("click", function () {
      var hiddenItems = recentFeedStack.querySelectorAll(".feed-item.hidden");
      var allItems = recentFeedStack.querySelectorAll(".feed-item");
      var labelSpan = feedMoreBtn.querySelector("span");

      if (hiddenItems.length > 0) {
        // Reveal items
        hiddenItems.forEach(function (el) {
          el.classList.remove("hidden");
        });
        labelSpan.textContent = "See less updates";
        feedMoreBtn.classList.add("expanded");
      } else {
        // Re-hide added mock items dynamically
        allItems.forEach(function (el, index) {
          if (index >= 2) {
            el.classList.add("hidden");
          }
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
// 6. STUDY WALLET — shared mock payment system
//    Runs on every page that loads dashboard.js. Injects a wallet balance
//    chip into the nav, plus a Fund Wallet modal and an Insufficient
//    Balance modal (both built once and appended to <body>, so no page's
//    HTML needs to be touched). Resource pages call window.SharefWallet
//    instead of touching localStorage directly.
//
//    NOTE: this is a frontend-only mock for the prototype stage. In a real
//    deployment the backend must own the balance check + deduction — the
//    frontend should never be trusted to decide whether a user can afford
//    something (see the "Security" section of the payment flow plan).
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  var WALLET_KEY = "sharef.walletBalance";
  var TX_KEY = "sharef.walletTransactions";
  var STARTER_BALANCE = 500; // so the flow is testable without funding first
  var MIN_FUND = 100;
  var MAX_BALANCE = 50000;

  var chipAmountEl = null;

  function formatNaira(amount) {
    return "₦" + Math.round(amount).toLocaleString("en-NG");
  }

  function getBalance() {
    var stored = window.localStorage.getItem(WALLET_KEY);
    if (stored === null) {
      window.localStorage.setItem(WALLET_KEY, String(STARTER_BALANCE));
      return STARTER_BALANCE;
    }
    return Number(stored) || 0;
  }

  function setBalance(next) {
    window.localStorage.setItem(WALLET_KEY, String(next));
    if (chipAmountEl) chipAmountEl.textContent = formatNaira(next);
  }

  function getTransactions() {
    try {
      return JSON.parse(window.localStorage.getItem(TX_KEY)) || [];
    } catch (err) {
      return [];
    }
  }

  function logTransaction(entry) {
    var txs = getTransactions();
    txs.unshift(entry);
    window.localStorage.setItem(TX_KEY, JSON.stringify(txs.slice(0, 10)));
  }

  // ------------------------------------------------------------------
  // Wallet chip (nav) — inserted right before the account menu so it
  // reads naturally as part of the account cluster on every page.
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
      "<span id=\"walletChipAmount\"></span>";

    if (accountWrapper && accountWrapper.parentNode === navActions) {
      navActions.insertBefore(chip, accountWrapper);
    } else {
      navActions.appendChild(chip);
    }

    chipAmountEl = chip.querySelector("#walletChipAmount");
    chipAmountEl.textContent = formatNaira(getBalance());

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
  // Fund Wallet modal
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
    var balance = getBalance();
    fundModalBody.innerHTML =
      '<h3 class="wallet-modal-title" id="fundModalTitle">Fund Study Wallet</h3>' +
      '<div class="wallet-balance-row"><span>Current Balance</span><strong>' +
      formatNaira(balance) +
      "</strong></div>" +
      '<label class="wallet-field-label" for="fundAmountInput">Amount</label>' +
      '<input type="number" id="fundAmountInput" class="wallet-amount-input" placeholder="Enter amount" min="' +
      MIN_FUND +
      '" step="50" />' +
      '<p class="wallet-hint">Minimum: ' +
      formatNaira(MIN_FUND) +
      " &middot; Maximum Wallet Balance: " +
      formatNaira(MAX_BALANCE) +
      "</p>" +
      '<p class="wallet-field-error" id="fundAmountError"></p>' +
      '<div class="wallet-modal-actions">' +
      '<button type="button" class="btn-wallet-primary" id="fundContinueBtn">Continue Payment</button>' +
      "</div>";

    var input = fundModalBody.querySelector("#fundAmountInput");
    var errorEl = fundModalBody.querySelector("#fundAmountError");
    var continueBtn = fundModalBody.querySelector("#fundContinueBtn");

    continueBtn.addEventListener("click", function () {
      var amount = Number(input.value);
      var currentBalance = getBalance();

      if (!amount || amount < MIN_FUND) {
        errorEl.textContent = "Enter at least " + formatNaira(MIN_FUND) + ".";
        return;
      }
      if (currentBalance + amount > MAX_BALANCE) {
        errorEl.textContent =
          "That would exceed the maximum wallet balance of " + formatNaira(MAX_BALANCE) + ".";
        return;
      }

      // Mock "payment": credited instantly for the prototype. A real
      // integration would call a payment provider here and only credit
      // the wallet once the backend confirms the charge succeeded.
      var newBalance = currentBalance + amount;
      setBalance(newBalance);
      logTransaction({
        type: "deposit",
        amount: amount,
        description: "Wallet Funding",
        date: "Just now",
      });
      renderFundSuccess(newBalance);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") continueBtn.click();
    });
  }

  function renderFundSuccess(newBalance) {
    fundModalBody.innerHTML =
      '<h3 class="wallet-modal-title">Thank You!</h3>' +
      '<p class="wallet-modal-subtitle">Your wallet has been credited.</p>' +
      '<div class="wallet-balance-row"><span>Current Balance</span><strong>' +
      formatNaira(newBalance) +
      "</strong></div>" +
      '<p class="wallet-modal-subtitle">You can now continue downloading resources.</p>' +
      '<div class="wallet-modal-actions">' +
      '<button type="button" class="btn-wallet-primary" id="fundSuccessContinueBtn">Continue</button>' +
      "</div>";

    fundModalBody
      .querySelector("#fundSuccessContinueBtn")
      .addEventListener("click", closeFundModal);
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
  // Insufficient Balance modal
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
  // Public API for resource pages (lecture-notes.js, past-questions.js)
  // ------------------------------------------------------------------
  window.SharefWallet = {
    getBalance: getBalance,
    formatNaira: formatNaira,
    getTransactions: getTransactions,
    showToast: showWalletToast,
    openFundModal: openFundModal,

    // Attempts to charge `cost` for `description`. Returns true and
    // deducts the balance if funds are sufficient. Otherwise it opens
    // the Insufficient Balance modal itself and returns false, so the
    // caller just needs to bail out of the download when it gets false.
    charge: function (cost, description) {
      var balance = getBalance();
      if (balance < cost) {
        openInsufficientModal(cost, balance);
        return false;
      }
      setBalance(balance - cost);
      logTransaction({
        type: "download",
        amount: -cost,
        description: description,
        date: "Just now",
      });
      return true;
    },
  };
});

// ==========================================================================
// 7. RESOURCE DOWNLOAD MODAL — payment popup for the dashboard
//    (Recently Added feed + Trending resource cards).
//
//    Same pay-per-page logic as past-questions.js: cost is derived from a
//    `pages` count using the tiered pricing formula (see calculateResourceCost
//    below) and charged through the shared window.SharefWallet.charge()
//    from section 6 above — which already
//    handles the Insufficient Balance flow, so this section never has to
//    duplicate the balance check itself.
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  if (!window.SharefWallet) return; // section 6 should always run first, but stay safe

  // Mock per-resource metadata, keyed by the title already rendered in the
  // DOM — mirrors the shape of past-questions.js's mockResources, just
  // without needing to touch dashboard.html to attach it.
  var feedResourceData = {
    "Operating Systems Notes": { course: "CSC 304", type: "PDF Document", size: "3.4 MB", pages: 10, downloads: 640 },
    "Database Systems Summary": { course: "CSC 308", type: "Revision Sheet", size: "1.2 MB", pages: 4, downloads: 275 },
    "CSC 204 Computer Architecture Notes": { course: "CSC 204", type: "PDF Document", size: "2.6 MB", pages: 9, downloads: 410 },
    "MTH 202 Differential Equations Guide": { course: "MTH 202", type: "Text File", size: "1.8 MB", pages: 6, downloads: 190 },
  };

  var trendingResourceData = {
    "CSC 201 Mid Semester Exam Notes": { course: "CSC 201", type: "PDF", size: "2.0 MB", pages: 7, downloads: "1.2k" },
    "Past Questions — CSC 202": { course: "CSC 202", type: "Exam Archive", size: "2.8 MB", pages: 11, downloads: "860" },
  };

  // Tiered pricing: 1-5 pages flat ₦200; 6-24 pages add ₦20/page; 25+
  // pages add ₦10/page. Kept in sync with the backend's utils/pricing.js —
  // the server always computes the real charge independently, this is
  // purely for accurate display before the user confirms payment.
  function calculateResourceCost(pages) {
    if (pages <= 5) return 200;
    if (pages <= 24) return 200 + (pages - 5) * 20;
    return 580 + (pages - 24) * 10;
  }

  function getResourceCost(item) {
    return calculateResourceCost(item.pages);
  }

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
  var DOWNLOAD_BTN_DEFAULT_TEXT = "Download File";

  var currentDownloadItem = null; // { title, data }

  function openDownloadModal(title, data) {
    currentDownloadItem = { title: title, data: data };
    var cost = getResourceCost(data);

    downloadTagEl.textContent = data.type || "Resource";
    downloadTitleEl.textContent = title;
    downloadMetaEl.textContent = data.course || "";
    downloadSizeEl.textContent = data.size;
    downloadPagesEl.textContent = data.pages + " Pages";
    downloadDownloadsEl.textContent = data.downloads;
    downloadPriceEl.textContent = window.SharefWallet.formatNaira(cost);
    downloadConfirmBtn.textContent = "Download File · " + window.SharefWallet.formatNaira(cost);

    downloadOverlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
    downloadCloseBtn.focus();
  }

  function closeDownloadModal() {
    downloadOverlay.classList.remove("is-open");
    document.body.style.overflow = "";
    currentDownloadItem = null;
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
    if (!currentDownloadItem) return;
    var cost = getResourceCost(currentDownloadItem.data);
    var description =
      (currentDownloadItem.data.course ? currentDownloadItem.data.course + " — " : "") + currentDownloadItem.title;

    // Exactly the same charge flow as past-questions.js: charge() deducts
    // and returns true, or opens the Insufficient Balance modal itself and
    // returns false — nothing else to do here in that case.
    var charged = window.SharefWallet.charge(cost, description);
    if (!charged) return;

    window.SharefWallet.showToast(
      window.SharefWallet.formatNaira(cost) + ' deducted · "' + currentDownloadItem.title + '" download started.'
    );
    closeDownloadModal();
  });

  // ------------------------------------------------------------------
  // Triggers: "Download" / "Preview" links in Recently Added, and the
  // Trending resource cards (clicking the card previews it, same as
  // tapping "Preview" does on the Past Questions page).
  // ------------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var feedLink = e.target.closest(".feed-inline-link");
    if (feedLink) {
      e.preventDefault();
      var feedItem = feedLink.closest(".feed-item");
      var feedTitleEl = feedItem && feedItem.querySelector("h3");
      var feedTitle = feedTitleEl ? feedTitleEl.textContent.trim() : null;
      var feedData = feedTitle && feedResourceData[feedTitle];
      if (feedData) openDownloadModal(feedTitle, feedData);
      return;
    }

    var card = e.target.closest(".resource-card");
    if (card && !e.target.closest(".icon-btn-badge")) {
      var cardTitleEl = card.querySelector(".card-body-zone h3");
      var cardTitle = cardTitleEl ? cardTitleEl.textContent.trim() : null;
      var cardData = cardTitle && trendingResourceData[cardTitle];
      if (cardData) openDownloadModal(cardTitle, cardData);
    }
  });
});
