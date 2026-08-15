document.addEventListener("DOMContentLoaded", () => {
  const currentUser = requireAuth("admin"); // redirects away if not a logged-in admin
  if (!currentUser) return;

  wireLogoutButton();

  fetch(`${API_BASE}/admin/users/filter-options`, {
    headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) return;
      const deptSelect = document.getElementById("filterDept");
      data.departments.forEach((dept) => {
        const opt = document.createElement("option");
        opt.value = dept;
        opt.textContent = dept;
        deptSelect.appendChild(opt);
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
  const searchInput = document.getElementById("userSearch");
  const tableBody = document.getElementById("userTableBody");
  const emptyState = document.getElementById("emptyState");

  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase();

    // Simulating database filtering logic.
    // In production, an Axios or Fetch call to your Express API handles this.
    if (term === "csc" || term === "fake_user") {
      tableBody.parentNode.style.display = "none";
      emptyState.style.display = "block";
    } else {
      tableBody.parentNode.style.display = "table";
      emptyState.style.display = "none";
    }
  });

  /* ---- Modal Dismissal Listeners ---- */
  const modalOverlay = document.getElementById("userProfileModal");

  // Close when clicking the dark overlay background
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeUserProfile();
    }
  });

  /* ---- Transactions Tab: Mock Data ---- */
  // Frontend-prototype dataset. In production this would come from
  // something like GET /api/admin/transactions.
  const transactions = [
    {
      id: "txn_501",
      user: "Ebimotimi Shadrack",
      email: "ebimotimi.shadrack@fuotuoke.edu.ng",
      category: "active",
      type: "deposit",
      amount: 15000,
      date: "2026-07-08",
      status: "successful",
    },
    {
      id: "txn_502",
      user: "Jane Smith",
      email: "jane.smith@fuotuoke.edu.ng",
      category: "active",
      type: "deposit",
      amount: 8000,
      date: "2026-07-08",
      status: "successful",
    },
    {
      id: "txn_503",
      user: "John Doe",
      email: "john.doe@fuotuoke.edu.ng",
      category: "active",
      type: "purchase",
      amount: 2500,
      date: "2026-07-07",
      status: "successful",
    },
    {
      id: "txn_504",
      user: "Chidinma Okeke",
      email: "chidinma.okeke@fuotuoke.edu.ng",
      category: "inactive",
      type: "deposit",
      amount: 5000,
      date: "2026-07-01",
      status: "pending",
    },
    {
      id: "txn_505",
      user: "Tunde Bakare",
      email: "tunde.bakare@fuotuoke.edu.ng",
      category: "suspended",
      type: "withdrawal",
      amount: 12000,
      date: "2026-06-29",
      status: "failed",
    },
    {
      id: "txn_506",
      user: "Amaka Nwosu",
      email: "amaka.nwosu@fuotuoke.edu.ng",
      category: "active",
      type: "deposit",
      amount: 20000,
      date: "2026-07-06",
      status: "successful",
    },
    {
      id: "txn_507",
      user: "Bello Musa",
      email: "bello.musa@fuotuoke.edu.ng",
      category: "inactive",
      type: "deposit",
      amount: 3000,
      date: "2026-06-15",
      status: "successful",
    },
    {
      id: "txn_508",
      user: "Grace Effiong",
      email: "grace.effiong@fuotuoke.edu.ng",
      category: "suspended",
      type: "deposit",
      amount: 7500,
      date: "2026-06-20",
      status: "pending",
    },
    {
      id: "txn_509",
      user: "Emeka Obi",
      email: "emeka.obi@fuotuoke.edu.ng",
      category: "active",
      type: "purchase",
      amount: 1800,
      date: "2026-07-08",
      status: "successful",
    },
    {
      id: "txn_510",
      user: "Fatima Ibrahim",
      email: "fatima.ibrahim@fuotuoke.edu.ng",
      category: "inactive",
      type: "withdrawal",
      amount: 4000,
      date: "2026-05-30",
      status: "failed",
    },
  ];

  const CATEGORY_LABELS = {
    active: "Active Users",
    suspended: "Suspended Users",
    inactive: "Inactive Users",
  };

  function formatNaira(n) {
    return "₦" + n.toLocaleString("en-NG");
  }

  function computeCategorySummaries() {
    const summary = {
      active: { volume: 0, count: 0, users: new Set() },
      suspended: { volume: 0, count: 0, users: new Set() },
      inactive: { volume: 0, count: 0, users: new Set() },
    };
    transactions.forEach((t) => {
      const bucket = summary[t.category];
      if (!bucket) return;
      bucket.count++;
      bucket.users.add(t.user);
      if (t.type === "deposit" && t.status === "successful") {
        bucket.volume += t.amount;
      }
    });
    return summary;
  }

  function renderCategoryBreakdown() {
    const grid = document.getElementById("categoryBreakdownGrid");
    if (!grid) return;
    const summary = computeCategorySummaries();

    grid.innerHTML = Object.keys(summary)
      .map((key) => {
        const s = summary[key];
        const userCount = s.users.size;
        const avg = userCount > 0 ? Math.round(s.volume / userCount) : 0;
        return `
        <div class="category-card ${key}">
          <div class="category-card-header">
            <h4>${CATEGORY_LABELS[key]}</h4>
            <span class="status-badge ${key}">${key.charAt(0).toUpperCase() + key.slice(1)}</span>
          </div>
          <div class="category-card-volume">${formatNaira(s.volume)}</div>
          <div class="category-card-sub">Total deposit volume</div>
          <div class="category-card-meta">
            <span>Transactions<strong>${s.count}</strong></span>
            <span>Users<strong>${userCount}</strong></span>
            <span>Avg / User<strong>${formatNaira(avg)}</strong></span>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderTransactionsTable() {
    const tbody = document.getElementById("transactionsTableBody");
    const emptyState = document.getElementById("txnEmptyState");
    const table = tbody ? tbody.closest("table") : null;
    if (!tbody) return;

    const term = (
      document.getElementById("txnSearch")?.value || ""
    ).toLowerCase();
    const categoryFilter =
      document.getElementById("filterTxnCategory")?.value || "";
    const typeFilter = document.getElementById("filterTxnType")?.value || "";
    const statusFilter =
      document.getElementById("filterTxnStatus")?.value || "";

    const filtered = transactions.filter((t) => {
      const matchesTerm =
        !term ||
        t.user.toLowerCase().includes(term) ||
        t.email.toLowerCase().includes(term);
      const matchesCategory = !categoryFilter || t.category === categoryFilter;
      const matchesType = !typeFilter || t.type === typeFilter;
      const matchesStatus = !statusFilter || t.status === statusFilter;
      return matchesTerm && matchesCategory && matchesType && matchesStatus;
    });

    if (filtered.length === 0) {
      if (table) table.style.display = "none";
      if (emptyState) emptyState.style.display = "block";
      return;
    }
    if (table) table.style.display = "table";
    if (emptyState) emptyState.style.display = "none";

    tbody.innerHTML = filtered
      .map((t) => {
        const isDebit = t.type === "withdrawal";
        const initials = t.user
          .split(" ")
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase();
        return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="avatar">${initials}</div>
              <div class="user-info">
                <span class="user-name">${t.user}</span>
                <span class="user-email">${t.email}</span>
              </div>
            </div>
          </td>
          <td><span class="status-badge ${t.category}">${t.category.charAt(0).toUpperCase() + t.category.slice(1)}</span></td>
          <td>${t.type.charAt(0).toUpperCase() + t.type.slice(1)}</td>
          <td class="amount-cell${isDebit ? " is-debit" : ""}">${isDebit ? "-" : "+"}${formatNaira(t.amount)}</td>
          <td>${t.date}</td>
          <td><span class="status-badge ${t.status}">${t.status.charAt(0).toUpperCase() + t.status.slice(1)}</span></td>
        </tr>`;
      })
      .join("");
  }

  [
    "txnSearch",
    "filterTxnCategory",
    "filterTxnType",
    "filterTxnStatus",
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener(
      el.tagName === "SELECT" ? "change" : "input",
      renderTransactionsTable,
    );
  });

  renderCategoryBreakdown();
  renderTransactionsTable();

  /* ---- Suspension Logic ---- */
  const confirmSuspendBtn = document.getElementById("confirmSuspendBtn");

  confirmSuspendBtn.addEventListener("click", (e) => {
    const reasonSelect = document.getElementById("suspendReason");
    const selectedReason = reasonSelect.value;

    // Hard block: admins cannot proceed without logging a reason
    if (!selectedReason) {
      e.preventDefault();
      alert(
        "Action denied: you must select a documented reason for suspending this account.",
      );
      reasonSelect.focus();
      return;
    }

    // Log intent (ready to pass to Express routing)
    console.log(`Action: SUSPEND User. Reason logged: ${selectedReason}`);
    alert(`Account suspended successfully for: ${selectedReason}`);

    // Reset and close
    closeUserProfile();
  });
});

/* ---- Tab Control (Users / Transactions) ---- */
function switchUsersTab(tab) {
  const usersPanel = document.getElementById("usersTabPanel");
  const txnPanel = document.getElementById("transactionsTabPanel");
  const usersBtn = document.getElementById("tabUsersBtn");
  const txnBtn = document.getElementById("tabTransactionsBtn");

  const showUsers = tab === "users";
  usersPanel.classList.toggle("hidden", !showUsers);
  txnPanel.classList.toggle("hidden", showUsers);
  usersBtn.classList.toggle("is-active", showUsers);
  txnBtn.classList.toggle("is-active", !showUsers);
  usersBtn.setAttribute("aria-selected", String(showUsers));
  txnBtn.setAttribute("aria-selected", String(!showUsers));
}

/* ---- Modal Control Functions ---- */
function openUserProfile(userId) {
  // Future state:
  // 1. Fetch user data: fetch(`/api/admin/users/${userId}`)
  // 2. Populate the DOM elements (modalUserName, modalUserDept, etc.)

  const modal = document.getElementById("userProfileModal");
  modal.classList.remove("hidden");

  // Ensure the UI is reset to the default view upon opening
  document.getElementById("suspendForm").classList.add("hidden");
  document.getElementById("suspendBtn").style.display = "flex";
  document.getElementById("suspendReason").value = "";
}

function closeUserProfile() {
  document.getElementById("userProfileModal").classList.add("hidden");
}

function toggleSuspendForm() {
  document.getElementById("suspendBtn").style.display = "none";
  document.getElementById("suspendForm").classList.remove("hidden");
}
