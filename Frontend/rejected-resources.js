document.addEventListener("DOMContentLoaded", () => {
  const currentUser = requireAuth("admin"); // redirects away if not a logged-in admin
  if (!currentUser) return;

  wireLogoutButton();

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

  const FILE_ICON_TYPES = { pdf: "pdf", doc: "doc", docx: "doc", ppt: "ppt", pptx: "ppt" };

  /* ---- Filter options (departments) ---- */
  const filterDept = document.getElementById("filterDept");
  // Department list grows with real adoption, so this uses the searchable
  // combobox instead of a plain <select> — see searchable-select.js.
  const filterDeptEnhanced = new SearchableSelect(filterDept, { placeholder: "Search departments…" });

  authFetch(`${API_BASE}/admin/resources/filter-options`)
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) return;
      data.departments.forEach((dept) => {
        const opt = document.createElement("option");
        opt.value = dept;
        opt.textContent = dept;
        filterDept.appendChild(opt);
      });
      filterDeptEnhanced.refresh();
    })
    .catch((err) => console.error("Could not load filter options:", err));

  /* ---- Shared shell behaviour is already wired by dashboard.js ---- */

  /* ---- Search / filters / sort / pagination — real backend data ---- */
  const searchInput = document.getElementById("resourceSearch");
  const filterType = document.getElementById("filterType");
  const filterReason = document.getElementById("filterReason");
  const filterDate = document.getElementById("filterDate");
  const sortResources = document.getElementById("sortResources");
  const tableBody = document.getElementById("rejectedTableBody");
  const tableContainer = tableBody.closest("table");
  const emptyState = document.getElementById("emptyState");
  const statTotalRejected = document.getElementById("statTotalRejected");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const pageInfo = document.getElementById("pageInfo");

  let resourceCache = {};
  let currentPage = 1;
  let totalPages = 1;
  let searchDebounce = null;

  function buildQuery() {
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
    if (filterDept.value) params.set("department", filterDept.value);
    if (filterType.value) params.set("type", filterType.value);
    if (filterReason.value) params.set("reason", filterReason.value);
    if (filterDate.value) params.set("rejectionDate", filterDate.value);
    params.set("sort", sortResources.value);
    params.set("page", currentPage);
    return params.toString();
  }

  function fileIconClass(ext) {
    return FILE_ICON_TYPES[(ext || "").toLowerCase()] || "generic";
  }

  function loadRejectedResources() {
    tableBody.innerHTML = `<tr><td colspan="9" class="table-loading">Loading resources…</td></tr>`;
    tableContainer.style.display = "table";
    emptyState.style.display = "none";

    authFetch(`${API_BASE}/admin/resources/rejected?${buildQuery()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          tableBody.innerHTML = "";
          return;
        }

        resourceCache = {};
        data.resources.forEach((r) => { resourceCache[r.id] = r; });

        if (statTotalRejected) statTotalRejected.textContent = data.totalRejected.toLocaleString();

        totalPages = data.pagination.pages || 1;
        currentPage = data.pagination.page || 1;
        if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${Math.max(1, totalPages)}`;
        if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
        if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;

        renderTable(data.resources);
      })
      .catch((err) => {
        console.error("Could not load rejected resources:", err);
        tableBody.innerHTML = `<tr><td colspan="9" class="table-error">Could not load resources. Please refresh the page.</td></tr>`;
      });
  }

  function renderTable(resources) {
    tableBody.innerHTML = "";

    if (resources.length === 0) {
      tableContainer.style.display = "none";
      emptyState.style.display = "block";
      return;
    }

    tableContainer.style.display = "table";
    emptyState.style.display = "none";

    resources.forEach((r) => {
      const reasonLabel = REASON_LABELS[r.rejectionReason] || r.rejectionReason || "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div class="file-icon ${fileIconClass(r.fileExtension)}">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        </td>
        <td>
          <span class="res-title">${r.title}</span>
          <span class="res-type">${r.type}</span>
        </td>
        <td>
          <span class="res-dept">${r.department}</span>
          <span class="res-course">${r.course}</span>
        </td>
        <td>${r.uploader}</td>
        <td><span class="reason-text">${reasonLabel}</span></td>
        <td>${r.reviewedBy}</td>
        <td>${r.date}</td>
        <td><span class="status-badge rejected">Rejected</span></td>
        <td>
          <div class="action-buttons">
            <button class="btn-icon" title="Preview" aria-label="Preview document" onclick="previewResource('${r.id}')">
              <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            <button class="btn-view" onclick="openRejectedDetails('${r.id}')">Details</button>
          </div>
        </td>
      `;
      tableBody.appendChild(tr);
    });
  }

  window.__rejectedResourceCache = () => resourceCache;
  window.__reasonLabels = REASON_LABELS;
  window.__reloadRejectedResources = loadRejectedResources;

  loadRejectedResources();

  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      currentPage = 1;
      loadRejectedResources();
    }, 350);
  });

  [filterDept, filterType, filterReason, filterDate, sortResources].forEach((el) => {
    el.addEventListener("change", () => {
      currentPage = 1;
      loadRejectedResources();
    });
  });

  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      if (currentPage > 1) { currentPage -= 1; loadRejectedResources(); }
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      if (currentPage < totalPages) { currentPage += 1; loadRejectedResources(); }
    });
  }

  /* ---- Modal Overlay Dismissal ---- */
  const modalOverlay = document.getElementById("rejectedDetailsModal");
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeRejectedDetails();
    }
  });
});

/* ---- Modal Controls ---- */
function openRejectedDetails(resourceId) {
  const cache = window.__rejectedResourceCache ? window.__rejectedResourceCache() : {};
  const r = cache[resourceId];
  if (!r) return;

  window.__currentModalResourceId = resourceId;

  const modal = document.getElementById("rejectedDetailsModal");
  modal.classList.remove("hidden");

  document.getElementById("modalResTitle").textContent = r.title;

  const reasonLabel = (window.__reasonLabels && window.__reasonLabels[r.rejectionReason]) || r.rejectionReason || "—";
  const calloutReasonEl = modal.querySelector(".callout-reason");
  if (calloutReasonEl) calloutReasonEl.textContent = reasonLabel;
  const calloutNoteEl = modal.querySelector(".callout-note");
  if (calloutNoteEl) calloutNoteEl.textContent = `Rejected by ${r.reviewedBy} on ${r.date}.`;

  const metaVals = modal.querySelectorAll(".metadata-grid .val");
  if (metaVals.length >= 6) {
    metaVals[0].textContent = r.type;
    metaVals[1].textContent = r.course;
    metaVals[2].textContent = r.department;
    metaVals[3].textContent = `${r.level} Level`;
    metaVals[4].textContent = `${r.semester} Semester`;
    metaVals[5].textContent = r.session;
  }

  const descEl = modal.querySelector(".res-description");
  if (descEl) descEl.textContent = r.description || "No description provided.";

  const historyItems = modal.querySelectorAll(".history-text");
  if (historyItems.length >= 2) {
    historyItems[0].querySelector(".resource-name").textContent = `Uploaded by ${r.uploader}`;
    historyItems[0].querySelector(".resource-date").textContent = r.uploadedDate;
    historyItems[1].querySelector(".resource-name").textContent = `Rejected by ${r.reviewedBy}`;
    historyItems[1].querySelector(".resource-date").textContent = r.date;
  }
}

function closeRejectedDetails() {
  document.getElementById("rejectedDetailsModal").classList.add("hidden");
  window.__currentModalResourceId = null;
}

function previewResource(resourceId) {
  const cache = window.__rejectedResourceCache ? window.__rejectedResourceCache() : {};
  const r = cache[resourceId];
  if (!r || !r.fileUrl) {
    alert("Preview is not available for this resource.");
    return;
  }
  window.open(r.fileUrl, "_blank");
}

/* ---- Action Handlers ---- */
function restoreToPending(resourceId) {
  const id = resourceId || window.__currentModalResourceId;
  if (!id) return;

  const confirmed = confirm(
    "Are you sure you want to restore this resource? It will be moved back to the Pending review queue."
  );
  if (!confirmed) return;

  authFetch(`${API_BASE}/admin/resources/${id}/restore`, { method: "POST" })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        alert(data.message || "Could not restore this resource.");
        return;
      }
      alert("Resource successfully moved back to Pending.");
      closeRejectedDetails();
      if (window.__reloadRejectedResources) window.__reloadRejectedResources();
    })
    .catch((err) => {
      console.error(err);
      alert("Network error — could not restore this resource.");
    });
}

function confirmPermanentDelete(resourceId) {
  const id = resourceId || window.__currentModalResourceId;
  if (!id) return;

  const confirmed = confirm(
    "WARNING: this will permanently delete the resource from the database and storage. This action cannot be undone. Proceed?"
  );
  if (!confirmed) return;

  authFetch(`${API_BASE}/admin/resources/${id}`, { method: "DELETE" })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        alert(data.message || "Could not delete this resource.");
        return;
      }
      alert("Resource permanently deleted.");
      closeRejectedDetails();
      if (window.__reloadRejectedResources) window.__reloadRejectedResources();
    })
    .catch((err) => {
      console.error(err);
      alert("Network error — could not delete this resource.");
    });
}
