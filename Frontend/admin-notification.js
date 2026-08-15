document.addEventListener('DOMContentLoaded', () => {
  const currentUser = requireAuth("admin"); // redirects away if not a logged-in admin
  if (!currentUser) return;

  wireLogoutButton();

  /* ---- Shared shell behaviour (sidebar drawer + account menu) ---- */
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('scrim');
  const hamburgerBtn = document.getElementById('hamburgerBtn');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

  function openSidebar() {
    sidebar.classList.add('is-open');
    scrim.classList.add('is-visible');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    sidebar.classList.remove('is-open');
    scrim.classList.remove('is-visible');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
  }
  hamburgerBtn?.addEventListener('click', openSidebar);
  sidebarCloseBtn?.addEventListener('click', closeSidebar);
  scrim?.addEventListener('click', closeSidebar);

  const accountWrapper = document.getElementById('accountMenuWrapper');
  const accountTrigger = document.getElementById('accountMenuTrigger');
  const accountPanel = document.getElementById('accountMenuPanel');

  accountTrigger?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = accountWrapper.classList.toggle('is-open');
    accountTrigger.setAttribute('aria-expanded', String(isOpen));
    accountPanel.setAttribute('aria-hidden', String(!isOpen));
  });
  document.addEventListener('click', (e) => {
    if (accountWrapper && !accountWrapper.contains(e.target)) {
      accountWrapper.classList.remove('is-open');
      accountTrigger?.setAttribute('aria-expanded', 'false');
      accountPanel?.setAttribute('aria-hidden', 'true');
    }
  });

  /* ---- Mock notification feed (resource-upload alerts) ---- */
  let notifications = [
    { id: 'ntf_1', resourceId: 'req_101', title: 'Introduction to Java Programming', type: 'Lecture Note', dept: 'Computer Science', course: 'CSC 201', level: '200 Level', semester: 'First', session: '2025/2026', uploader: 'Ebimotimi Shadrack', size: '2.4 MB', timeAgo: '4 days ago', unread: true },
    { id: 'ntf_2', resourceId: 'req_102', title: 'Software Engineering Ethics', type: 'Assignment Material', dept: 'Computer Science', course: 'CSC 205', level: '200 Level', semester: 'First', session: '2025/2026', uploader: 'John Doe', size: '1.1 MB', timeAgo: '2 hours ago', unread: true },
    { id: 'ntf_3', resourceId: 'req_103', title: 'MTH 102 Past Questions', type: 'Past Question', dept: 'Mathematics', course: 'MTH 102', level: '100 Level', semester: 'Second', session: '2024/2025', uploader: 'Jane Smith', size: '4.5 MB', timeAgo: '3 hours ago', unread: true },
    { id: 'ntf_4', resourceId: 'req_104', title: 'Digital Logic Design Notes', type: 'Lecture Note', dept: 'Computer Science', course: 'CSC 220', level: '200 Level', semester: 'Second', session: '2025/2026', uploader: 'Aliyu Bello', size: '3.1 MB', timeAgo: 'Yesterday', unread: true },
    { id: 'ntf_5', resourceId: 'req_105', title: 'PHY 101 Lab Manual', type: 'Lecture Note', dept: 'Physics', course: 'PHY 101', level: '100 Level', semester: 'First', session: '2025/2026', uploader: 'Grace Okon', size: '5.8 MB', timeAgo: 'Yesterday', unread: true },
    { id: 'ntf_6', resourceId: 'req_106', title: 'Linear Algebra Assignment 3', type: 'Assignment Material', dept: 'Mathematics', course: 'MTH 204', level: '200 Level', semester: 'First', session: '2025/2026', uploader: 'Chidi Umeh', size: '0.8 MB', timeAgo: '3 days ago', unread: false },
    { id: 'ntf_7', resourceId: 'req_107', title: 'Organic Chemistry Notes', type: 'Lecture Note', dept: 'Chemistry', course: 'CHM 201', level: '200 Level', semester: 'First', session: '2025/2026', uploader: 'Fatima Sani', size: '2.9 MB', timeAgo: '5 days ago', unread: false },
  ];

  let currentFilter = 'all';
  let currentReviewId = null;

  const notifFeed = document.getElementById('notifFeed');
  const notifEmptyState = document.getElementById('notifEmptyState');
  const countAll = document.getElementById('countAll');
  const countUnread = document.getElementById('countUnread');
  const countRead = document.getElementById('countRead');
  const unreadInsightCount = document.getElementById('unreadInsightCount');
  const sidebarNotifCount = document.getElementById('sidebarNotifCount');
  const markAllReadBtn = document.getElementById('markAllReadBtn');
  const tabButtons = document.querySelectorAll('.tab-btn');

  const ICON_UPLOAD = '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3" /></svg>';

  function updateCounts() {
    const unreadItems = notifications.filter(n => n.unread);
    const readItems = notifications.filter(n => !n.unread);

    countAll.textContent = notifications.length;
    countUnread.textContent = unreadItems.length;
    countRead.textContent = readItems.length;
    unreadInsightCount.textContent = unreadItems.length;
    if (sidebarNotifCount) {
      sidebarNotifCount.textContent = unreadItems.length;
      sidebarNotifCount.style.display = unreadItems.length > 0 ? 'inline-block' : 'none';
    }
    markAllReadBtn.disabled = unreadItems.length === 0;
  }

  function renderFeed() {
    let items = notifications;
    if (currentFilter === 'unread') items = notifications.filter(n => n.unread);
    if (currentFilter === 'read') items = notifications.filter(n => !n.unread);

    notifFeed.innerHTML = '';

    if (items.length === 0) {
      notifEmptyState.classList.remove('hidden');
      notifFeed.classList.add('hidden');
      updateCounts();
      return;
    }
    notifEmptyState.classList.add('hidden');
    notifFeed.classList.remove('hidden');

    items.forEach(n => {
      const card = document.createElement('div');
      card.className = `notif-card ${n.unread ? 'is-unread' : 'is-read'}`;
      card.innerHTML = `
        <div class="notif-icon">${ICON_UPLOAD}</div>
        <div class="notif-body">
          <p class="notif-text"><strong>${n.uploader}</strong> uploaded <strong>${n.title}</strong></p>
          <div class="notif-meta">
            <span>${n.course}</span>
            <span class="dot-sep"></span>
            <span>${n.type}</span>
            <span class="dot-sep"></span>
            <span>${n.timeAgo}</span>
          </div>
        </div>
        ${n.unread ? '<span class="unread-dot" aria-hidden="true"></span>' : ''}
        <div class="notif-actions">
          <button class="btn-mark-toggle" title="${n.unread ? 'Mark as read' : 'Mark as unread'}" aria-label="${n.unread ? 'Mark as read' : 'Mark as unread'}" onclick="toggleRead('${n.id}')">
            ${n.unread
              ? '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" /></svg>'
              : '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>'}
          </button>
          <button class="btn-review" onclick="quickReview('${n.id}')">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            Review
          </button>
        </div>
      `;
      notifFeed.appendChild(card);
    });

    updateCounts();
  }

  /* ---- Tab switching ---- */
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      currentFilter = btn.dataset.filter;
      renderFeed();
    });
  });

  /* ---- Mark all as read ---- */
  markAllReadBtn.addEventListener('click', () => {
    notifications.forEach(n => (n.unread = false));
    renderFeed();
  });

  /* ---- Read/unread toggle (exposed for inline onclick) ---- */
  window.toggleRead = (id) => {
    const item = notifications.find(n => n.id === id);
    if (!item) return;
    item.unread = !item.unread;
    renderFeed();
  };

  /* ---- Quick Review Modal ---- */
  const quickReviewModal = document.getElementById('quickReviewModal');

  window.quickReview = (id) => {
    const item = notifications.find(n => n.id === id);
    if (!item) return;
    currentReviewId = id;

    document.getElementById('qrType').textContent = item.type;
    document.getElementById('qrTitle').textContent = item.title;
    document.getElementById('qrMeta').textContent = `${item.dept} • ${item.course} • ${item.semester} Semester • ${item.level}`;
    document.getElementById('qrUploader').textContent = item.uploader;
    document.getElementById('qrDate').textContent = item.timeAgo;
    document.getElementById('qrSize').textContent = item.size;
    document.getElementById('qrSession').textContent = item.session;

    // Opening the review is treated as reading the alert
    item.unread = false;
    renderFeed();

    quickReviewModal.classList.remove('hidden');
  };

  document.getElementById('closeQuickReview').addEventListener('click', () => {
    quickReviewModal.classList.add('hidden');
  });
  quickReviewModal.addEventListener('click', (e) => {
    if (e.target === quickReviewModal) quickReviewModal.classList.add('hidden');
  });

  document.getElementById('qrApprove').addEventListener('click', () => {
    if (!currentReviewId) return;
    notifications = notifications.filter(n => n.id !== currentReviewId);
    quickReviewModal.classList.add('hidden');
    alert('Resource approved successfully.');
    renderFeed();
    currentReviewId = null;
  });

  document.getElementById('qrReject').addEventListener('click', () => {
    if (!currentReviewId) return;
    notifications = notifications.filter(n => n.id !== currentReviewId);
    quickReviewModal.classList.add('hidden');
    alert('Resource rejected. Head to Rejected Resources to log a reason.');
    renderFeed();
    currentReviewId = null;
  });

  // Init
  renderFeed();
});
