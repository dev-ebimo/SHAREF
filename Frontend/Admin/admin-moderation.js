document.addEventListener("DOMContentLoaded", () => {
  const REASON_LABELS = {
    duplicate: "Duplicate Resource",
    wrong_course: "Wrong Course",
    wrong_dept: "Wrong Department",
    poor_quality: "Poor Quality",
    incomplete: "Incomplete Material",
    corrupted: "Corrupted File",
    unsupported: "Unsupported File",
    not_academic: "Not Academic",
    spam: "Spam",
    other: "Other",
  };
  // 1. Mock Database (Notice the 4+ days aged item)
  let pendingQueue = [
    {
      id: "req_101",
      title: "Introduction to Java Programming",
      type: "Lecture Note",
      dept: "Computer Science",
      course: "CSC 201",
      level: "200 Level",
      semester: "First",
      session: "2025/2026",
      uploader: "Ebimotimi Shadrack",
      size: "2.4 MB",
      uploadDate: "4 days ago",
      isAged: true,
    },
    {
      id: "req_102",
      title: "Software Engineering Ethics",
      type: "Assignment Material",
      dept: "Computer Science",
      course: "CSC 205",
      level: "200 Level",
      semester: "First",
      session: "2025/2026",
      uploader: "John Doe",
      size: "1.1 MB",
      uploadDate: "2 hours ago",
      isAged: false,
    },
    {
      id: "req_103",
      title: "MTH 102 Past Questions",
      type: "Past Question",
      dept: "Mathematics",
      course: "MTH 102",
      level: "100 Level",
      semester: "Second",
      session: "2024/2025",
      uploader: "Jane Smith",
      size: "4.5 MB",
      uploadDate: "Today",
      isAged: false,
    },
  ];

  let stats = { pending: 18, approved: 24, rejected: 6 };
  let currentReviewId = null;

  // Reusable inline icon markup (kept in one place so cards/badges stay in sync)
  const ICONS = {
    doc: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
    clock:
      '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    eye: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>',
    check:
      '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>',
    x: '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>',
    emptyCheck:
      '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
  };

  // DOM Elements
  const queueContainer = document.getElementById("moderationQueue");
  const previewModal = document.getElementById("previewModal");
  const approveModal = document.getElementById("approveModal");
  const rejectModal = document.getElementById("rejectModal");

  // Stats DOM
  const statPending = document.getElementById("statPending");
  const statPendingCard = document.getElementById("statPendingCard");
  const statApproved = document.getElementById("statApproved");
  const statRejected = document.getElementById("statRejected");
  const sidebarQueueCount = document.getElementById("sidebarQueueCount");
  const queueHealthRing = document.querySelector(".queue-health-ring");
  const queueHealthRingLabel = queueHealthRing
    ? queueHealthRing.querySelector("span")
    : null;

  // Reject Form Logic
  const rejectRadios = document.querySelectorAll('input[name="reason"]');
  const otherReasonText = document.getElementById("otherReasonText");

  rejectRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.value === "Other") {
        otherReasonText.classList.remove("hidden");
      } else {
        otherReasonText.classList.add("hidden");
      }
    });
  });

  // Render Queue
  function renderQueue() {
    queueContainer.innerHTML = "";

    if (pendingQueue.length === 0) {
      queueContainer.innerHTML = `
                <div class="queue-empty-state">
                    ${ICONS.emptyCheck}
                    <p>Queue is empty. Great job!</p>
                </div>`;
      return;
    }

    pendingQueue.forEach((item) => {
      const card = document.createElement("div");
      card.className = `queue-card ${item.isAged ? "aged-warning" : ""}`;

      let agedBadgeHTML = item.isAged
        ? `<span class="aged-badge">${ICONS.clock}4+ Days Pending</span>`
        : "";

      card.innerHTML = `
                <div class="q-left">
                    ${agedBadgeHTML}
                    <div class="q-title">${ICONS.doc}${item.title}</div>
                    <div class="q-meta">
                        <span>${item.type}</span>
                        <span class="dot-sep"></span>
                        <span>${item.course}</span>
                        <span class="dot-sep"></span>
                        <span>${item.level}</span>
                        <span class="dot-sep"></span>
                        <span>${item.semester} Sem</span>
                    </div>
                </div>
                <div class="q-right">
                    <div class="uploader-info">
                        Uploaded by <strong>${item.uploader}</strong><br>
                        ${item.uploadDate}
                    </div>
                    <div class="q-actions">
                        <button class="btn-sm btn-preview" onclick="openPreview('${item.id}')">${ICONS.eye}Preview</button>
                        <button class="btn-sm btn-approve" onclick="quickApprove('${item.id}')">${ICONS.check}Approve</button>
                        <button class="btn-sm btn-reject" onclick="quickReject('${item.id}')">${ICONS.x}Reject</button>
                    </div>
                </div>
            `;
      queueContainer.appendChild(card);
    });
  }

  // Modal Triggers (Exposed to Window for inline onclicks)
  window.openPreview = (id) => {
    const item = pendingQueue.find((i) => i.id === id);
    if (!item) return;

    currentReviewId = id;

    // Populate Modal Data
    document.getElementById("previewType").textContent = item.type;
    document.getElementById("previewTitle").textContent = item.title;
    document.getElementById("previewMeta").textContent =
      `${item.dept} • ${item.course} • ${item.semester} Semester • ${item.level}`;
    document.getElementById("previewUploader").textContent = item.uploader;
    document.getElementById("previewDate").textContent = item.uploadDate;
    document.getElementById("previewSize").textContent = item.size;
    document.getElementById("previewSession").textContent = item.session;

    previewModal.classList.remove("hidden");
  };

  window.quickApprove = (id) => {
    currentReviewId = id;
    approveModal.classList.remove("hidden");
  };

  window.quickReject = (id) => {
    currentReviewId = id;
    rejectModal.classList.remove("hidden");
  };

  // Close Modals
  document
    .getElementById("closePreviewModal")
    .addEventListener("click", () => previewModal.classList.add("hidden"));
  document
    .getElementById("cancelApprove")
    .addEventListener("click", () => approveModal.classList.add("hidden"));
  document
    .getElementById("cancelReject")
    .addEventListener("click", () => rejectModal.classList.add("hidden"));

  // Action Executions
  function processAction(actionType) {
    pendingQueue = pendingQueue.filter((item) => item.id !== currentReviewId);

    stats.pending--;
    if (actionType === "approve") stats.approved++;
    if (actionType === "reject") stats.rejected++;

    updateStatsUI();
    renderQueue();

    // Close all modals
    previewModal.classList.add("hidden");
    approveModal.classList.add("hidden");
    rejectModal.classList.add("hidden");
    currentReviewId = null;
  }

  document
    .getElementById("confirmApprove")
    .addEventListener("click", () => processAction("approve"));

  document.getElementById("confirmReject").addEventListener("click", () => {
    const selectedReason = document.querySelector(
      'input[name="reason"]:checked',
    );
    if (!selectedReason) {
      alert("Please select a rejection reason.");
      return;
    }
    processAction("reject");
  });

  // Sticky Action Bar in Preview Modal
  document.getElementById("btnPreviewApprove").addEventListener("click", () => {
    approveModal.classList.remove("hidden");
  });

  document.getElementById("btnPreviewReject").addEventListener("click", () => {
    rejectModal.classList.remove("hidden");
  });

  // Keyboard Shortcuts (Only active when Preview Modal is open)
  document.addEventListener("keydown", (e) => {
    if (
      !previewModal.classList.contains("hidden") &&
      approveModal.classList.contains("hidden") &&
      rejectModal.classList.contains("hidden")
    ) {
      if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        approveModal.classList.remove("hidden");
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        rejectModal.classList.remove("hidden");
      }
    }
  });

  function updateStatsUI() {
    statPending.textContent = stats.pending;
    if (statPendingCard) statPendingCard.textContent = stats.pending;
    statApproved.textContent = stats.approved;
    statRejected.textContent = stats.rejected;
    if (sidebarQueueCount) sidebarQueueCount.textContent = stats.pending;

    // Backlog ring: reflects pending share of today's total moderation volume
    const total = stats.pending + stats.approved + stats.rejected;
    const pct = total > 0 ? Math.round((stats.pending / total) * 100) : 0;
    if (queueHealthRing) queueHealthRing.style.setProperty("--pct", pct);
    if (queueHealthRingLabel) queueHealthRingLabel.textContent = stats.pending;
  }

  // MOBILE NAVIGATION (HAMBURGER MENU) LOGIC
  const hamburgerBtn = document.getElementById("hamburgerBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
  const scrim = document.getElementById("scrim");

  // Function to open the mobile sidebar drawer
  function openSidebar() {
    sidebar.classList.add("is-open");
    scrim.classList.add("is-visible");
    hamburgerBtn.setAttribute("aria-expanded", "true");
  }

  // Function to close the mobile sidebar drawer
  function closeSidebar() {
    sidebar.classList.remove("is-open");
    scrim.classList.remove("is-visible");
    hamburgerBtn.setAttribute("aria-expanded", "false");
  }

  // Event Listeners
  if (hamburgerBtn) hamburgerBtn.addEventListener("click", openSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", closeSidebar);
  if (scrim) scrim.addEventListener("click", closeSidebar);

  // ACCOUNT MENU (PROFILE ICON) DROPDOWN LOGIC
  const accountWrapper = document.getElementById("accountMenuWrapper");
  const accountTrigger = document.getElementById("accountMenuTrigger");
  const accountPanel = document.getElementById("accountMenuPanel");

  accountTrigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = accountWrapper.classList.toggle("is-open");
    accountTrigger.setAttribute("aria-expanded", String(isOpen));
    accountPanel.setAttribute("aria-hidden", String(!isOpen));
  });
  document.addEventListener("click", (e) => {
    if (accountWrapper && !accountWrapper.contains(e.target)) {
      accountWrapper.classList.remove("is-open");
      accountTrigger?.setAttribute("aria-expanded", "false");
      accountPanel?.setAttribute("aria-hidden", "true");
    }
  });

  // Init
  updateStatsUI();
  renderQueue();
});
