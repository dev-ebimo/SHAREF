document.addEventListener("DOMContentLoaded", () => {
  // Real data — fetched from GET /api/resources/past-questions, which
  // already supports server-side search/session/semester/level/sort
  // filtering matching this page's controls exactly.
  let mockResources = [];

  function transformResource(r) {
    return {
      id: r.id,
      title: r.title,
      course: r.course,
      type: r.type,
      session: r.session,
      semester: r.semester,
      level: r.level,
      size: r.size,
      pages: r.pages,
      downloads: r.downloads,
      date: r.date,
    };
  }

  let fetchToken = 0;
  async function fetchPastQuestions() {
    const params = new URLSearchParams({
      search: searchInput.value.trim(),
      session: sessionFilter.value,
      semester: semesterFilter.value,
      level: levelFilter.value,
      sort: sortOrder.value,
    });
    const currentToken = ++fetchToken;
    const res = await authFetch(`${API_BASE}/resources/past-questions?${params.toString()}`);
    const data = await res.json();
    if (currentToken !== fetchToken) return; // a newer request has since started — ignore this stale response
    if (!data.success) {
      showToast(data.message || "Could not load past questions.");
      return;
    }
    mockResources = data.resources.map(transformResource);
    renderTimeline();
  }

  const timelineContainer = document.getElementById("timelineContainer");
  const emptyState = document.getElementById("emptyState");
  const resultsCounter = document.getElementById("resultsCounter");

  const searchInput = document.getElementById("pqSearch");
  const sessionFilter = document.getElementById("sessionFilter");
  const semesterFilter = document.getElementById("semesterFilter");
  const levelFilter = document.getElementById("levelFilter");
  const sortOrder = document.getElementById("sortOrder");

  const previewModal = document.getElementById("previewModal");
  const previewScrim = document.getElementById("previewScrim");
  const closeModalBtn = document.getElementById("closeModal");
  const modalTitle = document.getElementById("modalTitle");
  const modalMeta = document.getElementById("modalMeta");
  const modalSize = document.getElementById("modalSize");
  const modalPages = document.getElementById("modalPages");
  const modalDownloads = document.getElementById("modalDownloads");
  const modalBookmarkBtn = document.getElementById("modalBookmarkBtn");
  const modalDownloadBtn = document.getElementById("modalDownloadBtn");

  // --- Toast (replaces the old alert() calls) ---
  const toast = document.getElementById("pqToast");
  let toastTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  // Pricing mirrors the backend's tiered formula (utils/pricing.js) via the
  // shared window.SharefWallet.calculateCost helper in dashboard.js, so the
  // price shown here matches what the download modal will actually charge
  // — a flat ₦10/page estimate used to live here and under-priced anything
  // under 25 pages.
  function getResourceCost(item) {
    return window.SharefWallet.calculateCost(item.pages);
  }

  // The reusable document-icon SVG markup (replaces the old 📄 emoji)
  const fileIconSvg =
    '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
    '<path d="M9 12h6m-6 4h4m3 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' +
    "</svg>";

  let currentPreviewItem = null;

  let searchDebounceTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(fetchPastQuestions, 350);
  });
  [sessionFilter, semesterFilter, levelFilter, sortOrder].forEach((el) => {
    el.addEventListener("input", fetchPastQuestions);
  });

  // The static info-strip only ships with Size / Pages / Downloads — this
  // adds a matching "Price" item once, dynamically, so no HTML edit is
  // needed to surface the download cost before the user commits to it.
  const infoStrip = document.querySelector(".info-strip");
  let modalPrice = null;
  if (infoStrip) {
    const priceItem = document.createElement("div");
    priceItem.className = "info-item";
    priceItem.innerHTML = '<span class="label">Price</span><span id="modalPrice" class="val"></span>';
    infoStrip.appendChild(priceItem);
    modalPrice = priceItem.querySelector("#modalPrice");
  }

  function openPreviewModal(item) {
    currentPreviewItem = item;
    const cost = getResourceCost(item);

    modalTitle.textContent = item.title;
    modalMeta.textContent = `${item.course} • ${item.session} Session • ${item.semester} Semester`;
    modalSize.textContent = item.size;
    modalPages.textContent = `${item.pages} Pages`;
    modalDownloads.textContent = item.downloads;
    if (modalPrice) modalPrice.textContent = window.SharefWallet.formatNaira(cost);
    modalDownloadBtn.textContent = `Download File · ${window.SharefWallet.formatNaira(cost)}`;

    previewModal.classList.add("is-visible");
    previewScrim.classList.add("is-visible");
    previewModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    closeModalBtn.focus();

    modalBookmarkBtn.textContent = "Bookmark";
    authFetch(`${API_BASE}/bookmarks/check/${item.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && currentPreviewItem === item) {
          modalBookmarkBtn.textContent = data.bookmarked ? "Remove Bookmark" : "Bookmark";
        }
      })
      .catch((err) => console.error(err));
  }

  function closePreviewModal() {
    previewModal.classList.remove("is-visible");
    previewScrim.classList.remove("is-visible");
    previewModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    currentPreviewItem = null;
  }

  closeModalBtn.addEventListener("click", closePreviewModal);
  previewScrim.addEventListener("click", closePreviewModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && previewModal.classList.contains("is-visible")) {
      closePreviewModal();
    }
  });

  modalDownloadBtn.addEventListener("click", () => {
    if (!currentPreviewItem) return;
    const cost = getResourceCost(currentPreviewItem);
    window.SharefWallet.charge(currentPreviewItem.id, `${currentPreviewItem.course} — ${currentPreviewItem.title}`).then((data) => {
      if (!data.success) return;
      if (data.fileUrl) window.open(data.fileUrl, "_blank");
      showToast(`${window.SharefWallet.formatNaira(data.amountCharged || cost)} deducted · "${currentPreviewItem.title}" download started.`);
      closePreviewModal();
    });
  });

  modalBookmarkBtn.addEventListener("click", () => {
    if (!currentPreviewItem) return;
    const item = currentPreviewItem;
    modalBookmarkBtn.disabled = true;
    authFetch(`${API_BASE}/bookmarks/${item.id}`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        modalBookmarkBtn.disabled = false;
        if (!data.success) {
          showToast(data.message || "Could not update bookmark.");
          return;
        }
        if (currentPreviewItem === item) {
          modalBookmarkBtn.textContent = data.bookmarked ? "Remove Bookmark" : "Bookmark";
        }
        showToast(data.bookmarked ? `"${item.title}" saved to bookmarks.` : `"${item.title}" removed from bookmarks.`);
      })
      .catch((err) => {
        modalBookmarkBtn.disabled = false;
        console.error(err);
        showToast("Network error — could not update bookmark.");
      });
  });

  // Pre-fills the level filter from the user's completed profile — the
  // payoff for completing the "Add your department" banner. Level is a
  // controlled enum here (100/200/.../500), so unlike department elsewhere,
  // no fallback "add a missing option" logic is needed.
  async function applyProfileLevelPrefill() {
    try {
      const res = await authFetch(`${API_BASE}/users/me`);
      const data = await res.json();
      if (data.success && data.user.level) {
        levelFilter.value = data.user.level;
      }
    } catch (err) {
      console.error("Could not load profile for filter prefill:", err);
    }
  }

  applyProfileLevelPrefill().then(fetchPastQuestions).catch((err) => {
    console.error(err);
    showToast("Could not load past questions.");
  });

  // The backend already applied search/session/semester/level filtering
  // and sorting server-side (see fetchPastQuestions) — this just groups
  // and renders the result set it received.
  function renderTimeline() {
    timelineContainer.innerHTML = "";

    const dataPool = mockResources;

    resultsCounter.textContent = `Results (${dataPool.length})`;

    if (dataPool.length === 0) {
      timelineContainer.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");
    timelineContainer.classList.remove("hidden");

    const aggregatedGroups = {};
    dataPool.forEach((item) => {
      if (!aggregatedGroups[item.course]) aggregatedGroups[item.course] = [];
      aggregatedGroups[item.course].push(item);
    });

    for (const courseCode in aggregatedGroups) {
      const groupSection = document.createElement("div");
      groupSection.className = "course-group";
      groupSection.innerHTML = `<h2 class="course-title-heading">${courseCode}</h2>`;

      const trackTimeline = document.createElement("div");
      trackTimeline.className = "timeline-track";

      aggregatedGroups[courseCode].forEach((item) => {
        const itemRowNode = document.createElement("div");
        itemRowNode.className = "timeline-item";

        itemRowNode.innerHTML = `
                    <div class="timeline-node"></div>
                    <div class="pq-card">
                        <div class="card-left">
                            <span class="file-icon-badge" aria-hidden="true">${fileIconSvg}</span>
                            <div class="card-details">
                                <h3>${item.title}</h3>
                                <div class="card-metrics">
                                    <span>${item.semester} Semester</span>
                                    <span>•</span>
                                    <span>${item.pages} Pages</span>
                                    <span>•</span>
                                    <span>${item.size}</span>
                                    <span>•</span>
                                    <span>${item.downloads} Downloads</span>
                                </div>
                            </div>
                        </div>
                        <div class="card-right">
                            <span class="year-badge">${item.session}</span>
                            <div class="card-actions">
                                <button class="btn-preview preview-trigger">Preview</button>
                                <button class="btn-download-icon download-trigger" title="Download Resource" aria-label="Download File">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7 10 12 15 17 10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                `;

        itemRowNode.querySelector(".preview-trigger").addEventListener("click", () => {
          openPreviewModal(item);
        });

        itemRowNode.querySelector(".download-trigger").addEventListener("click", () => {
          const cost = getResourceCost(item);
          window.SharefWallet.charge(item.id, `${item.course} — ${item.title}`).then((data) => {
            if (!data.success) return;
            if (data.fileUrl) window.open(data.fileUrl, "_blank");
            showToast(`${window.SharefWallet.formatNaira(data.amountCharged || cost)} deducted · "${item.title}" download started.`);
          });
        });

        trackTimeline.appendChild(itemRowNode);
      });

      groupSection.appendChild(trackTimeline);
      timelineContainer.appendChild(groupSection);
    }
  }
});
