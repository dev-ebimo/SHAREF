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
  
  fetch(`${API_BASE}/admin/resources/filter-options`, {
  headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
})
  .then((res) => res.json())
  .then((data) => {
    if (!data.success) return;
    const courseSelect = document.getElementById("filterCourse");
    data.courses.forEach((course) => {
      const opt = document.createElement("option");
      opt.value = course;
      opt.textContent = course;
      courseSelect.appendChild(opt);
    });
  });
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

  /* ---- Search UI Logic (Frontend Prototype) ---- */
  const searchInput = document.getElementById("resourceSearch");
  const tableBody = document.getElementById("resourceTableBody");
  const emptyState = document.getElementById("emptyState");

  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();

    // Simulate empty state for the frontend MVP
    if (term === "empty") {
      tableBody.parentNode.style.display = "none";
      emptyState.style.display = "block";
    } else {
      tableBody.parentNode.style.display = "table";
      emptyState.style.display = "none";
    }
  });

  /* ---- Modal Overlay Dismissal ---- */
  const modalOverlay = document.getElementById("resourceDetailsModal");
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeResourceDetails();
    }
  });

  /* ---- Removal Logic ---- */
  const confirmRemoveBtn = document.getElementById("confirmRemoveBtn");

  confirmRemoveBtn.addEventListener("click", (e) => {
    const reasonSelect = document.getElementById("removeReason");
    const selectedReason = reasonSelect.value;

    if (!selectedReason) {
      e.preventDefault();
      alert(
        "Action denied: you must select a reason for removing this resource.",
      );
      reasonSelect.focus();
      return;
    }

    // Log intent (ready to pass to Express routing)
    console.log(`Action: REMOVE Resource. Reason: ${selectedReason}`);
    alert(`Resource removed successfully for reason: ${selectedReason}`);

    closeResourceDetails();
    // In production, also remove the row from the DOM or refetch the table data here.
  });
});

/* ---- Modal Controls ---- */
function openResourceDetails(resourceId) {
  // Fetch logic for your Node backend goes here

  const modal = document.getElementById("resourceDetailsModal");
  modal.classList.remove("hidden");

  // Reset removal form
  document.getElementById("removeForm").classList.add("hidden");
  document.getElementById("removeResBtn").style.display = "flex";
  document.getElementById("removeReason").value = "";
}

function closeResourceDetails() {
  document.getElementById("resourceDetailsModal").classList.add("hidden");
}

function toggleRemoveForm() {
  document.getElementById("removeResBtn").style.display = "none";
  document.getElementById("removeForm").classList.remove("hidden");
}

function previewResource(resourceId) {
  // Opens the document preview in a new tab per moderation preferences
  console.log(`Opening preview for ${resourceId} in a new tab...`);
  // window.open(`/api/resources/preview/${resourceId}`, '_blank');
  alert("Preview would open the document safely in a new tab.");
}
