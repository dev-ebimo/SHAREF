document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = "http://localhost:5000/api";
  const token = localStorage.getItem("token");

  /* ---- Shared shell behaviour (sidebar drawer + account menu) ---- */
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("scrim");
  const hamburgerBtn = document.getElementById("hamburgerBtn");
  const sidebarCloseBtn = document.getElementById("sidebarCloseBtn");

  function openSidebar() {
    sidebar.classList.add("is-open");
    scrim.classList.add("is-visible");
    hamburgerBtn.setAttribute("aria-expanded", "true");
  }
  function closeSidebar() {
    sidebar.classList.remove("is-open");
    scrim.classList.remove("is-visible");
    hamburgerBtn.setAttribute("aria-expanded", "false");
  }
  hamburgerBtn?.addEventListener("click", openSidebar);
  sidebarCloseBtn?.addEventListener("click", closeSidebar);
  scrim?.addEventListener("click", closeSidebar);

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

  /* ---- Toast ---- */
  const toast = document.getElementById("announcementToast");
  let toastTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
  }

  /* ---- Populate department options dynamically (reuses the resources filter-options endpoint) ---- */
  const deptSelect = document.getElementById("annDepartments");
  fetch(`${API_BASE}/admin/resources/filter-options`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) return;
      data.departments.forEach((dept) => {
        const opt = document.createElement("option");
        opt.value = dept;
        opt.textContent = dept;
        deptSelect.appendChild(opt);
      });
    })
    .catch((err) => console.error("Could not load departments:", err));

  /* ---- Send announcement ---- */
  const sendBtn = document.getElementById("sendAnnouncementBtn");
  const sendConfirm = document.getElementById("sendConfirm");
  const sendConfirmText = document.getElementById("sendConfirmText");

  function getSelectedValues(selectEl) {
    return Array.from(selectEl.selectedOptions).map((opt) => opt.value);
  }

  sendBtn.addEventListener("click", () => {
    const title = document.getElementById("annTitle").value.trim();
    const message = document.getElementById("annMessage").value.trim();
    const departments = getSelectedValues(deptSelect);
    const levels = getSelectedValues(document.getElementById("annLevels"));

    if (!title || !message) {
      showToast("Title and message are both required.");
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";

    fetch(`${API_BASE}/admin/announcements`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, message, departments, levels }),
    })
      .then((res) => res.json())
      .then((data) => {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send Announcement";

        if (!data.success) {
          showToast(data.message || "Could not send announcement.");
          return;
        }

        sendConfirmText.textContent = data.message;
        sendConfirm.classList.remove("hidden");
        setTimeout(() => sendConfirm.classList.add("hidden"), 3000);

        document.getElementById("annTitle").value = "";
        document.getElementById("annMessage").value = "";
        Array.from(deptSelect.options).forEach((opt) => (opt.selected = false));
        Array.from(document.getElementById("annLevels").options).forEach((opt) => (opt.selected = false));

        loadHistory();
      })
      .catch((err) => {
        sendBtn.disabled = false;
        sendBtn.textContent = "Send Announcement";
        showToast("Network error — could not send announcement.");
        console.error(err);
      });
  });

  /* ---- History list ---- */
  const historyContainer = document.getElementById("announcementHistory");
  const historyEmptyState = document.getElementById("historyEmptyState");

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  function loadHistory() {
    fetch(`${API_BASE}/admin/announcements`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;

        if (data.announcements.length === 0) {
          historyContainer.innerHTML = "";
          historyEmptyState.classList.remove("hidden");
          return;
        }
        historyEmptyState.classList.add("hidden");

        historyContainer.innerHTML = data.announcements.map((a) => {
          const deptTags = a.targetDepartments.length > 0
            ? a.targetDepartments.map((d) => `<span class="announcement-tag">${d}</span>`).join("")
            : `<span class="announcement-tag">All Departments</span>`;
          const levelTags = a.targetLevels.length > 0
            ? a.targetLevels.map((l) => `<span class="announcement-tag">${l} Level</span>`).join("")
            : `<span class="announcement-tag">All Levels</span>`;

          return `
            <div class="announcement-item">
              <div class="announcement-item-header">
                <h3>${a.title}</h3>
                <span class="sent-date">${formatDate(a.createdAt)}</span>
              </div>
              <p>${a.message}</p>
              <div class="announcement-item-meta">
                ${deptTags}
                ${levelTags}
                <span class="announcement-tag">${a.recipientCount} recipient${a.recipientCount === 1 ? "" : "s"}</span>
                <span class="announcement-tag">By ${a.createdBy?.fullName || "Admin"}</span>
              </div>
            </div>`;
        }).join("");
      })
      .catch((err) => console.error("Could not load announcement history:", err));
  }

  loadHistory();
});
