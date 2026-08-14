document.addEventListener("DOMContentLoaded", () => {
  const mockResources = [
    { id: 401, title: "Intro to Computer Structures Exam", course: "CSC 201", type: "Past Questions", session: "2024/2025", semester: "First", level: "200", size: "2.4 MB", pages: 8, downloads: 142, date: "March 12" },
    { id: 402, title: "Data Architecture Final Evaluation Paper", course: "CSC 201", type: "Past Questions", session: "2023/2024", semester: "First", level: "200", size: "1.9 MB", pages: 6, downloads: 98, date: "Feb 04" },
    { id: 403, title: "Discrete Structures Logic Evaluation Matrix", course: "CSC 205", type: "Past Questions", session: "2024/2025", semester: "First", level: "200", size: "3.1 MB", pages: 14, downloads: 210, date: "May 19" },
    { id: 404, title: "Linear Algebra Exam Matrix Paper", course: "MTH 102", type: "Past Questions", session: "2024/2025", semester: "Second", level: "100", size: "1.7 MB", pages: 4, downloads: 320, date: "June 02" },
    { id: 405, title: "Calculus Fundamentals Assessment Tracker", course: "MTH 102", type: "Past Questions", session: "2023/2024", semester: "Second", level: "100", size: "2.2 MB", pages: 5, downloads: 185, date: "Jan 15" },
  ];

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

  // Pricing follows the ₦10/page model used across the app — cost is
  // derived from `pages` rather than hardcoded, so it stays in sync if the
  // mock data changes and swaps in cleanly for a real per-resource price
  // field later.
  const PRICE_PER_PAGE = 10;
  function getResourceCost(item) {
    return item.pages * PRICE_PER_PAGE;
  }

  // The reusable document-icon SVG markup (replaces the old 📄 emoji)
  const fileIconSvg =
    '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">' +
    '<path d="M9 12h6m-6 4h4m3 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' +
    "</svg>";

  let currentPreviewItem = null;

  [searchInput, sessionFilter, semesterFilter, levelFilter, sortOrder].forEach((el) => {
    el.addEventListener("input", queryAndRenderTimeline);
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
    // NOTE: charge() is now async and expects a real backend resource id —
    // this page still uses mock item.id values, so charges here will fail
    // against the real API until this page gets its own real-data wiring.
    window.SharefWallet.charge(currentPreviewItem.id, `${currentPreviewItem.course} — ${currentPreviewItem.title}`).then((data) => {
      if (!data.success) return;
      if (data.fileUrl) window.open(data.fileUrl, "_blank");
      showToast(`${window.SharefWallet.formatNaira(data.amountCharged || cost)} deducted · "${currentPreviewItem.title}" download started.`);
      closePreviewModal();
    });
  });

  modalBookmarkBtn.addEventListener("click", () => {
    if (!currentPreviewItem) return;
    showToast(`"${currentPreviewItem.title}" saved to bookmarks.`);
  });

  queryAndRenderTimeline();

  function queryAndRenderTimeline() {
    timelineContainer.innerHTML = "";

    const query = searchInput.value.toLowerCase().trim();
    const selectedSession = sessionFilter.value;
    const selectedSemester = semesterFilter.value;
    const selectedLevel = levelFilter.value;
    const selectedSort = sortOrder.value;

    let dataPool = mockResources.filter((item) => {
      const matchesSearch = item.course.toLowerCase().includes(query) || item.title.toLowerCase().includes(query);
      const matchesSession = selectedSession === "all" || item.session === selectedSession;
      const matchesSemester = selectedSemester === "all" || item.semester === selectedSemester;
      const matchesLevel = selectedLevel === "all" || item.level === selectedLevel;
      return matchesSearch && matchesSession && matchesSemester && matchesLevel;
    });

    if (selectedSort === "downloads") {
      dataPool.sort((a, b) => b.downloads - a.downloads);
    } else if (selectedSort === "oldest") {
      dataPool.sort((a, b) => a.id - b.id);
    } else {
      dataPool.sort((a, b) => b.id - a.id);
    }

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
