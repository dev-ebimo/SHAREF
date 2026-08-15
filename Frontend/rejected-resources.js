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
  const tableBody = document.getElementById("rejectedTableBody");
  const emptyState = document.getElementById("emptyState");

  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();

    if (term === "empty") {
      tableBody.parentNode.style.display = "none";
      emptyState.style.display = "block";
    } else {
      tableBody.parentNode.style.display = "table";
      emptyState.style.display = "none";
    }
  });

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
  // Production: fetch logic for /api/admin/resources/rejected/:id
  document.getElementById("rejectedDetailsModal").classList.remove("hidden");
}

function closeRejectedDetails() {
  document.getElementById("rejectedDetailsModal").classList.add("hidden");
}

function previewResource(resourceId) {
  console.log(`Opening preview for ${resourceId} in a new tab...`);
  alert("Previewing rejected document...");
}

/* ---- Action Handlers ---- */
function restoreToPending(resourceId) {
  // Allows moderators to reverse an accidental rejection
  const confirmed = confirm(
    "Are you sure you want to restore this resource? It will be moved back to the Pending review queue.",
  );

  if (confirmed) {
    console.log(`Action: RESTORE TO PENDING -> ${resourceId}`);
    alert("Resource successfully moved back to Pending.");
    closeRejectedDetails();
    // Production: Axios/Fetch call to Express to update DB status, then remove row from DOM
  }
}

function confirmPermanentDelete(resourceId) {
  // Hard delete, wipes from storage and database
  const confirmed = confirm(
    "WARNING: this will permanently delete the resource from the database and storage. This action cannot be undone. Proceed?",
  );

  if (confirmed) {
    console.log(`Action: PERMANENT DELETE -> ${resourceId}`);
    alert("Resource permanently deleted.");
    closeRejectedDetails();
    // Production: Axios/Fetch call to Express to DELETE from DB/S3/Disk, then remove row from DOM
  }
}
