document.addEventListener("DOMContentLoaded", () => {
  const currentUser = requireAuth("admin"); // redirects away if not a logged-in admin
  if (!currentUser) return;

  wireLogoutButton();

  /* ---- Filter options (departments) ---- */
  const filterDept = document.getElementById("filterDept");
  // Department list grows with real adoption, so this uses the searchable
  // combobox instead of a plain <select> — see searchable-select.js.
  const filterDeptEnhanced = new SearchableSelect(filterDept, { placeholder: "Search departments…" });

  authFetch(`${API_BASE}/admin/users/filter-options`)
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

  function initials(name) {
    return (name || "")
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function formatNaira(n) {
    return "₦" + Number(n || 0).toLocaleString("en-NG");
  }

  /* =====================================================================
     USERS TAB
     ===================================================================== */
  const userSearchInput = document.getElementById("userSearch");
  const filterLevel = document.getElementById("filterLevel");
  const filterStatus = document.getElementById("filterStatus");
  const filterContribution = document.getElementById("filterContribution");
  const userTableBody = document.getElementById("userTableBody");
  const userTableContainer = userTableBody.closest("table");
  const userEmptyState = document.getElementById("emptyState");
  const statTotalUsers = document.getElementById("statTotalUsers");
  const statTotalUsersCard = document.getElementById("statTotalUsersCard");
  const statActiveThisWeek = document.getElementById("statActiveThisWeek");
  const statContributors = document.getElementById("statContributors");
  const userPrevPageBtn = document.getElementById("userPrevPageBtn");
  const userNextPageBtn = document.getElementById("userNextPageBtn");
  const userPageInfo = document.getElementById("userPageInfo");

  let userCurrentPage = 1;
  let userTotalPages = 1;
  let userSearchDebounce = null;

  function buildUsersQuery() {
    const params = new URLSearchParams();
    if (userSearchInput.value.trim()) params.set("search", userSearchInput.value.trim());
    if (filterDept.value) params.set("department", filterDept.value);
    if (filterLevel.value) params.set("level", filterLevel.value);
    if (filterStatus.value) params.set("status", filterStatus.value);
    if (filterContribution.value) params.set("contribution", filterContribution.value);
    params.set("page", userCurrentPage);
    return params.toString();
  }

  function loadUsers() {
    userTableBody.innerHTML = `<tr><td colspan="8" class="table-loading">Loading users…</td></tr>`;
    userTableContainer.style.display = "table";
    userEmptyState.style.display = "none";

    authFetch(`${API_BASE}/admin/users?${buildUsersQuery()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          userTableBody.innerHTML = "";
          return;
        }

        if (statTotalUsers) statTotalUsers.textContent = data.stats.totalUsers.toLocaleString();
        if (statTotalUsersCard) statTotalUsersCard.textContent = data.stats.totalUsers.toLocaleString();
        if (statActiveThisWeek) statActiveThisWeek.textContent = data.stats.activeThisWeek.toLocaleString();
        if (statContributors) statContributors.textContent = data.stats.contributors.toLocaleString();

        userTotalPages = data.pagination.pages || 1;
        userCurrentPage = data.pagination.page || 1;
        if (userPageInfo) userPageInfo.textContent = `Page ${userCurrentPage} of ${Math.max(1, userTotalPages)}`;
        if (userPrevPageBtn) userPrevPageBtn.disabled = userCurrentPage <= 1;
        if (userNextPageBtn) userNextPageBtn.disabled = userCurrentPage >= userTotalPages;

        renderUsersTable(data.users);
      })
      .catch((err) => {
        console.error("Could not load users:", err);
        userTableBody.innerHTML = `<tr><td colspan="8" class="table-error">Could not load users. Please refresh the page.</td></tr>`;
      });
  }

  function renderUsersTable(users) {
    userTableBody.innerHTML = "";

    if (users.length === 0) {
      userTableContainer.style.display = "none";
      userEmptyState.style.display = "block";
      return;
    }

    userTableContainer.style.display = "table";
    userEmptyState.style.display = "none";

    users.forEach((u) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div class="user-cell">
            <div class="avatar">${initials(u.fullName)}</div>
            <div class="user-info">
              <span class="user-name">${u.fullName}</span>
              <span class="user-email">${u.email}</span>
            </div>
          </div>
        </td>
        <td>${u.department}</td>
        <td>${u.level}</td>
        <td>${u.uploadsCount}</td>
        <td>${u.approvedCount}</td>
        <td>${u.rejectedCount}</td>
        <td><span class="status-badge ${u.accountStatus}">${capitalize(u.accountStatus)}</span></td>
        <td><button class="btn-view" onclick="openUserProfile('${u.id}')">View</button></td>
      `;
      userTableBody.appendChild(tr);
    });
  }

  loadUsers();

  userSearchInput.addEventListener("input", () => {
    clearTimeout(userSearchDebounce);
    userSearchDebounce = setTimeout(() => {
      userCurrentPage = 1;
      loadUsers();
    }, 350);
  });

  [filterDept, filterLevel, filterStatus, filterContribution].forEach((el) => {
    el.addEventListener("change", () => {
      userCurrentPage = 1;
      loadUsers();
    });
  });

  if (userPrevPageBtn) {
    userPrevPageBtn.addEventListener("click", () => {
      if (userCurrentPage > 1) { userCurrentPage -= 1; loadUsers(); }
    });
  }
  if (userNextPageBtn) {
    userNextPageBtn.addEventListener("click", () => {
      if (userCurrentPage < userTotalPages) { userCurrentPage += 1; loadUsers(); }
    });
  }

  window.__reloadUsers = loadUsers;

  /* ---- Modal Dismissal Listeners ---- */
  const modalOverlay = document.getElementById("userProfileModal");
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      closeUserProfile();
    }
  });

  /* ---- Suspension Logic ---- */
  const confirmSuspendBtn = document.getElementById("confirmSuspendBtn");

  confirmSuspendBtn.addEventListener("click", (e) => {
    const reasonSelect = document.getElementById("suspendReason");
    const selectedReason = reasonSelect.value;

    if (!selectedReason) {
      e.preventDefault();
      alert("Action denied: you must select a documented reason for suspending this account.");
      reasonSelect.focus();
      return;
    }

    const id = window.__currentModalUserId;
    if (!id) return;

    confirmSuspendBtn.disabled = true;
    const originalText = confirmSuspendBtn.textContent;
    confirmSuspendBtn.textContent = "Suspending...";

    authFetch(`${API_BASE}/admin/users/${id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: selectedReason }),
    })
      .then((res) => res.json())
      .then((data) => {
        confirmSuspendBtn.disabled = false;
        confirmSuspendBtn.textContent = originalText;

        if (!data.success) {
          alert(data.message || "Could not suspend this account.");
          return;
        }

        closeUserProfile();
        loadUsers();
      })
      .catch((err) => {
        confirmSuspendBtn.disabled = false;
        confirmSuspendBtn.textContent = originalText;
        console.error(err);
        alert("Network error — could not suspend this account.");
      });
  });

  /* =====================================================================
     TRANSACTIONS TAB
     ===================================================================== */
  const CATEGORY_LABELS = { active: "Active Users", suspended: "Suspended Users", inactive: "Inactive Users" };

  const txnSearchInput = document.getElementById("txnSearch");
  const filterTxnCategory = document.getElementById("filterTxnCategory");
  const filterTxnType = document.getElementById("filterTxnType");
  const filterTxnStatus = document.getElementById("filterTxnStatus");
  const txnTableBody = document.getElementById("transactionsTableBody");
  const txnTableContainer = txnTableBody.closest("table");
  const txnEmptyState = document.getElementById("txnEmptyState");
  const statTotalVolume = document.getElementById("statTotalVolume");
  const statTotalTxns = document.getElementById("statTotalTxns");
  const statPendingTxns = document.getElementById("statPendingTxns");
  const txnPrevPageBtn = document.getElementById("txnPrevPageBtn");
  const txnNextPageBtn = document.getElementById("txnNextPageBtn");
  const txnPageInfo = document.getElementById("txnPageInfo");

  let txnCurrentPage = 1;
  let txnTotalPages = 1;
  let txnSearchDebounce = null;

  function loadTransactionSummary() {
    authFetch(`${API_BASE}/admin/transactions/summary`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) return;
        renderCategoryBreakdown(data.summary);

        let totalVolume = 0, totalCount = 0;
        Object.values(data.summary).forEach((s) => { totalVolume += s.volume; totalCount += s.count; });
        if (statTotalVolume) statTotalVolume.textContent = formatNaira(totalVolume);
        if (statTotalTxns) statTotalTxns.textContent = totalCount.toLocaleString();
      })
      .catch((err) => console.error("Could not load transaction summary:", err));
  }

  function renderCategoryBreakdown(summary) {
    const grid = document.getElementById("categoryBreakdownGrid");
    if (!grid) return;

    grid.innerHTML = Object.keys(CATEGORY_LABELS)
      .map((key) => {
        const s = summary[key] || { volume: 0, count: 0, users: 0 };
        const avg = s.users > 0 ? Math.round(s.volume / s.users) : 0;
        return `
        <div class="category-card ${key}">
          <div class="category-card-header">
            <h4>${CATEGORY_LABELS[key]}</h4>
            <span class="status-badge ${key}">${capitalize(key)}</span>
          </div>
          <div class="category-card-volume">${formatNaira(s.volume)}</div>
          <div class="category-card-sub">Total deposit volume</div>
          <div class="category-card-meta">
            <span>Transactions<strong>${s.count}</strong></span>
            <span>Users<strong>${s.users}</strong></span>
            <span>Avg / User<strong>${formatNaira(avg)}</strong></span>
          </div>
        </div>`;
      })
      .join("");
  }

  function buildTxnQuery() {
    const params = new URLSearchParams();
    if (txnSearchInput.value.trim()) params.set("search", txnSearchInput.value.trim());
    if (filterTxnCategory.value) params.set("category", filterTxnCategory.value);
    if (filterTxnType.value) params.set("type", filterTxnType.value);
    if (filterTxnStatus.value) params.set("status", filterTxnStatus.value);
    params.set("page", txnCurrentPage);
    return params.toString();
  }

  function loadTransactions() {
    txnTableBody.innerHTML = `<tr><td colspan="6" class="table-loading">Loading transactions…</td></tr>`;
    txnTableContainer.style.display = "table";
    txnEmptyState.style.display = "none";

    authFetch(`${API_BASE}/admin/transactions?${buildTxnQuery()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) {
          txnTableBody.innerHTML = "";
          return;
        }

        const pendingCount = data.transactions.filter((t) => t.status === "pending").length;
        if (statPendingTxns) statPendingTxns.textContent = pendingCount.toLocaleString();

        txnTotalPages = data.pagination.pages || 1;
        txnCurrentPage = data.pagination.page || 1;
        if (txnPageInfo) txnPageInfo.textContent = `Page ${txnCurrentPage} of ${Math.max(1, txnTotalPages)}`;
        if (txnPrevPageBtn) txnPrevPageBtn.disabled = txnCurrentPage <= 1;
        if (txnNextPageBtn) txnNextPageBtn.disabled = txnCurrentPage >= txnTotalPages;

        renderTransactionsTable(data.transactions);
      })
      .catch((err) => {
        console.error("Could not load transactions:", err);
        txnTableBody.innerHTML = `<tr><td colspan="6" class="table-error">Could not load transactions. Please refresh the page.</td></tr>`;
      });
  }

  function renderTransactionsTable(transactions) {
    txnTableBody.innerHTML = "";

    if (transactions.length === 0) {
      txnTableContainer.style.display = "none";
      txnEmptyState.style.display = "block";
      return;
    }

    txnTableContainer.style.display = "table";
    txnEmptyState.style.display = "none";

    transactions.forEach((t) => {
      const isDebit = t.type === "withdrawal" || t.type === "purchase";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div class="user-cell">
            <div class="avatar">${initials(t.user)}</div>
            <div class="user-info">
              <span class="user-name">${t.user}</span>
              <span class="user-email">${t.email}</span>
            </div>
          </div>
        </td>
        <td><span class="status-badge ${t.category}">${capitalize(t.category)}</span></td>
        <td>${capitalize(t.type)}</td>
        <td class="amount-cell${isDebit ? " is-debit" : ""}">${isDebit ? "-" : "+"}${formatNaira(t.amount)}</td>
        <td>${new Date(t.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</td>
        <td><span class="status-badge ${t.status}">${capitalize(t.status)}</span></td>
      `;
      txnTableBody.appendChild(tr);
    });
  }

  loadTransactionSummary();
  loadTransactions();

  txnSearchInput.addEventListener("input", () => {
    clearTimeout(txnSearchDebounce);
    txnSearchDebounce = setTimeout(() => {
      txnCurrentPage = 1;
      loadTransactions();
    }, 350);
  });

  [filterTxnCategory, filterTxnType, filterTxnStatus].forEach((el) => {
    el.addEventListener("change", () => {
      txnCurrentPage = 1;
      loadTransactions();
    });
  });

  if (txnPrevPageBtn) {
    txnPrevPageBtn.addEventListener("click", () => {
      if (txnCurrentPage > 1) { txnCurrentPage -= 1; loadTransactions(); }
    });
  }
  if (txnNextPageBtn) {
    txnNextPageBtn.addEventListener("click", () => {
      if (txnCurrentPage < txnTotalPages) { txnCurrentPage += 1; loadTransactions(); }
    });
  }
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
  window.__currentModalUserId = userId;

  const modal = document.getElementById("userProfileModal");
  modal.classList.remove("hidden");

  // Reset to default view while the real data loads
  document.getElementById("suspendForm").classList.add("hidden");
  document.getElementById("suspendReason").value = "";
  document.getElementById("modalUserName").textContent = "Loading…";

  authFetch(`${API_BASE}/admin/users/${userId}`)
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        alert(data.message || "Could not load this user's profile.");
        closeUserProfile();
        return;
      }
      populateUserProfileModal(data.user);
    })
    .catch((err) => {
      console.error(err);
      alert("Network error — could not load this user's profile.");
      closeUserProfile();
    });
}

function populateUserProfileModal(u) {
  const modal = document.getElementById("userProfileModal");

  const avatarEl = modal.querySelector(".avatar.large");
  if (avatarEl) {
    avatarEl.textContent = (u.fullName || "")
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  document.getElementById("modalUserName").textContent = u.fullName;
  document.getElementById("modalUserDept").textContent = u.department;
  document.getElementById("modalUserLevel").textContent = u.level;

  const joinDateEl = modal.querySelector(".join-date");
  if (joinDateEl) joinDateEl.textContent = `Joined ${u.joinedDate}`;

  const statusLabel = u.accountStatus.charAt(0).toUpperCase() + u.accountStatus.slice(1);
  const headerBadge = modal.querySelector(".profile-header .status-badge");
  if (headerBadge) {
    headerBadge.className = `status-badge ${u.accountStatus}`;
    headerBadge.textContent = statusLabel;
  }

  // "Contribution Score" — there's no dedicated backend metric for this yet,
  // so it's derived from approval rate + upload volume as the closest
  // meaningful stand-in.
  let rank = "New Member";
  if (u.uploadsCount > 0) {
    if (u.approvalRate >= 80) rank = "High Contributor";
    else if (u.approvalRate >= 50) rank = "Active Contributor";
    else rank = "Needs Improvement";
  }
  const scoreRankEl = modal.querySelector(".score-rank");
  if (scoreRankEl) scoreRankEl.textContent = rank;
  const scoreValueEl = modal.querySelector(".score-value");
  if (scoreValueEl) scoreValueEl.textContent = u.approvalRate;

  const statNums = modal.querySelectorAll(".profile-stats .stat-num");
  if (statNums.length >= 3) {
    statNums[0].textContent = u.uploadsCount;
    statNums[1].textContent = `${u.approvalRate}%`;
    statNums[2].textContent = u.totalDownloads;
  }

  const historyList = modal.querySelector(".upload-history");
  if (historyList) {
    if (u.recentUploads.length === 0) {
      historyList.innerHTML = `<li class="history-item"><div class="history-text"><span class="resource-name">No uploads yet</span></div></li>`;
    } else {
      historyList.innerHTML = u.recentUploads
        .map(
          (r) => `
        <li class="history-item">
          <div class="history-text">
            <span class="resource-name">${r.title}</span>
            <span class="resource-date">${r.date}</span>
          </div>
          <span class="status-badge ${r.status}">${r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>
        </li>`
        )
        .join("");
    }
  }

  // Suspend vs. Reactivate — swap the action button based on current status
  const suspendBtn = document.getElementById("suspendBtn");
  if (suspendBtn) {
    if (u.accountStatus === "suspended") {
      suspendBtn.textContent = "Reactivate Account";
      suspendBtn.classList.remove("btn-danger");
      suspendBtn.classList.add("btn-warning");
      suspendBtn.setAttribute("onclick", "reactivateCurrentUser()");
      suspendBtn.style.display = "flex";
    } else {
      suspendBtn.textContent = "Suspend Account";
      suspendBtn.classList.remove("btn-warning");
      suspendBtn.classList.add("btn-danger");
      suspendBtn.setAttribute("onclick", "toggleSuspendForm()");
      suspendBtn.style.display = "flex";
    }
  }
}

function closeUserProfile() {
  document.getElementById("userProfileModal").classList.add("hidden");
  window.__currentModalUserId = null;
}

function toggleSuspendForm() {
  document.getElementById("suspendBtn").style.display = "none";
  document.getElementById("suspendForm").classList.remove("hidden");
}

function reactivateCurrentUser() {
  const id = window.__currentModalUserId;
  if (!id) return;

  const confirmed = confirm("Reactivate this account? The user will be able to log in again immediately.");
  if (!confirmed) return;

  authFetch(`${API_BASE}/admin/users/${id}/reactivate`, { method: "POST" })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        alert(data.message || "Could not reactivate this account.");
        return;
      }
      alert("Account reactivated successfully.");
      closeUserProfile();
      if (window.__reloadUsers) window.__reloadUsers();
    })
    .catch((err) => {
      console.error(err);
      alert("Network error — could not reactivate this account.");
    });
}
