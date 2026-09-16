var currentUser = requireAuth("admin");

document.addEventListener('DOMContentLoaded', () => {
    if (!currentUser) return;
    wireLogoutButton();

    // Real data, populated by loadQueue() below
    let pendingQueue = [];
    let stats = { pending: 0, approved: 0, rejected: 0 };
    let currentReviewId = null;
    let currentPage = 1;

    // The admin's own preferences (see admin-settings.html's "Moderation
    // Preferences" / "Review Preferences") — fetched once on load and
    // applied to the default sort, page size, and confirm-before-action
    // behavior below. Empty objects here just mean "use the fetch's own
    // fallback defaults" if this request hasn't resolved yet or fails.
    let adminPreferences = { review: {}, moderation: {} };

    function loadAdminPreferences() {
        return authFetch(API_BASE + '/users/me')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.user && data.user.preferences) {
                    adminPreferences = data.user.preferences;
                }
            })
            .catch(err => console.error('Could not load admin preferences:', err));
    }

    // Reusable inline icon markup (kept in one place so cards/badges stay in sync)
    const ICONS = {
        doc: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>',
        clock: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
        eye: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>',
        check: '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>',
        x: '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>',
        emptyCheck: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
    };

    // DOM Elements
    const queueContainer = document.getElementById('moderationQueue');
    const previewModal = document.getElementById('previewModal');
    const approveModal = document.getElementById('approveModal');
    const rejectModal = document.getElementById('rejectModal');

    // Stats DOM
    const statPending = document.getElementById('statPending');
    const statPendingCard = document.getElementById('statPendingCard');
    const statApproved = document.getElementById('statApproved');
    const statRejected = document.getElementById('statRejected');
    const sidebarQueueCount = document.getElementById('sidebarQueueCount');
    const queueHealthRing = document.querySelector('.queue-health-ring');
    const queueHealthRingLabel = queueHealthRing ? queueHealthRing.querySelector('span') : null;

    // Reject Form Logic
    const rejectRadios = document.querySelectorAll('input[name="reason"]');
    const otherReasonText = document.getElementById('otherReasonText');

    rejectRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if(e.target.value === 'other') {
                otherReasonText.classList.remove('hidden');
            } else {
                otherReasonText.classList.add('hidden');
            }
        });
    });

    // ------------------------------------------------------------------
    // Real data loading
    // ------------------------------------------------------------------
    function loadQueue() {
        const sortSelect = document.getElementById('sortQueue');
        const sortValue = sortSelect ? sortSelect.value : 'oldest';
        const itemsPerPage = (adminPreferences.moderation && adminPreferences.moderation.itemsPerPage) || 0;

        let url = API_BASE + '/admin/moderation/queue?sort=' + sortValue + '&page=' + currentPage;
        if (itemsPerPage > 0) url += '&limit=' + itemsPerPage;

        return authFetch(url)
            .then(res => res.json())
            .then(data => {
                if (!data.success) return;

                // If approving/rejecting emptied out the page we were on
                // (e.g. we were on the last page and just cleared its only
                // remaining item), the requested page no longer exists —
                // fall back to the new last page instead of showing an
                // empty queue when items still exist on an earlier page.
                if (data.pagination && data.pagination.page > data.pagination.pages && data.pagination.pages >= 1) {
                    currentPage = data.pagination.pages;
                    return loadQueue();
                }

                pendingQueue = data.queue;
                stats = data.stats;
                updateStatsUI();
                renderQueue();
                if (data.pagination) updatePaginationUI(data.pagination);
            })
            .catch(err => console.error('Could not load moderation queue:', err));
    }

    function updatePaginationUI(pagination) {
        currentPage = pagination.page;
        const pageInfo = document.getElementById('pageInfo');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        if (pageInfo) pageInfo.textContent = `Page ${pagination.page} of ${pagination.pages}`;
        if (prevBtn) prevBtn.disabled = pagination.page <= 1;
        if (nextBtn) nextBtn.disabled = pagination.page >= pagination.pages;
    }

    // Render Queue
    function renderQueue() {
        queueContainer.innerHTML = '';

        if (pendingQueue.length === 0) {
            queueContainer.innerHTML = `
                <div class="queue-empty-state">
                    ${ICONS.emptyCheck}
                    <p>Queue is empty. Great job!</p>
                </div>`;
            return;
        }

        pendingQueue.forEach(item => {
            const card = document.createElement('div');
            card.className = `queue-card ${item.isAged ? 'aged-warning' : ''}`;

            let agedBadgeHTML = item.isAged
                ? `<span class="aged-badge">${ICONS.clock}4+ Days Pending</span>`
                : '';

            card.innerHTML = `
                <div class="q-left">
                    ${agedBadgeHTML}
                    <div class="q-title">${ICONS.doc}${escapeHtml(item.title)}</div>
                    <div class="q-meta">
                        <span>${escapeHtml(item.type)}</span>
                        <span class="dot-sep"></span>
                        <span>${escapeHtml(item.course)}</span>
                        <span class="dot-sep"></span>
                        <span>${item.level}</span>
                        <span class="dot-sep"></span>
                        <span>${item.semester} Sem</span>
                    </div>
                </div>
                <div class="q-right">
                    <div class="uploader-info">
                        Uploaded by <strong>${escapeHtml(item.uploader)}</strong><br>
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
        const item = pendingQueue.find(i => i.id === id);
        if(!item) return;

        currentReviewId = id;

        document.getElementById('previewType').textContent = item.type;
        document.getElementById('previewTitle').textContent = item.title;
        document.getElementById('previewMeta').textContent = `${escapeHtml(item.dept)} • ${escapeHtml(item.course)} • ${item.semester} Semester • ${item.level}`;
        document.getElementById('previewUploader').textContent = item.uploader;
        document.getElementById('previewDate').textContent = item.uploadDate;
        document.getElementById('previewSize').textContent = item.size;
        document.getElementById('previewSession').textContent = item.session;

        const placeholderEl = document.getElementById('docPreviewPlaceholder');
        const textEl = document.getElementById('docPreviewText');
        const fullTextEl = document.getElementById('docPreviewFullText');
        const downloadBtn = document.getElementById('docPreviewDownloadBtn');

        // Reset to the loading state — the full document (all text, or the
        // download link) is fetched fresh each time, not cached on the
        // queue item.
        fullTextEl.classList.add('hidden');
        fullTextEl.textContent = '';
        downloadBtn.classList.add('hidden');
        downloadBtn.removeAttribute('href');
        placeholderEl.classList.remove('hidden');
        textEl.textContent = 'Loading preview…';

        previewModal.classList.remove('hidden');

        authFetch(API_BASE + '/admin/moderation/' + id + '/preview')
            .then(res => res.json())
            .then(data => {
                if (currentReviewId !== id) return; // modal moved on to something else

                if (data.previewType === 'text') {
                    placeholderEl.classList.add('hidden');
                    fullTextEl.classList.remove('hidden');
                    fullTextEl.textContent = data.fullText;
                } else {
                    // "image" (PDF) and "none" both land here — inline PDF
                    // embedding wasn't reliable, so there's no iframe;
                    // just the message plus a free download to review.
                    textEl.textContent = data.message || 'Preview not available for this file type.';
                }

                if (data.fileUrl) {
                    downloadBtn.href = data.fileUrl;
                    downloadBtn.classList.remove('hidden');
                }
            })
            .catch(() => {
                if (currentReviewId !== id) return;
                textEl.textContent = 'Preview not available right now.';
            });
    };

    window.quickApprove = (id) => {
        requestApprove(id);
    };

    function requestApprove(id) {
        currentReviewId = id;
        const skipConfirm = adminPreferences.moderation && adminPreferences.moderation.confirmBeforeApproval === false;
        if (skipConfirm) {
            processApprove();
        } else {
            approveModal.classList.remove('hidden');
        }
    }

    window.quickReject = (id) => {
        currentReviewId = id;
        rejectModal.classList.remove('hidden');
    };

    // Close Modals
    document.getElementById('closePreviewModal').addEventListener('click', () => previewModal.classList.add('hidden'));
    document.getElementById('cancelApprove').addEventListener('click', () => approveModal.classList.add('hidden'));
    document.getElementById('cancelReject').addEventListener('click', () => rejectModal.classList.add('hidden'));

    // ------------------------------------------------------------------
    // Real action executions
    // ------------------------------------------------------------------
    function closeAllModals() {
        previewModal.classList.add('hidden');
        approveModal.classList.add('hidden');
        rejectModal.classList.add('hidden');
        currentReviewId = null;
    }

    function processApprove() {
        if (!currentReviewId) return;
        authFetch(API_BASE + '/admin/moderation/' + currentReviewId + '/approve', { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                if (!data.success) { alert(data.message || 'Could not approve resource.'); return; }
                closeAllModals();
                loadQueue().then(maybeOpenNextItem);
            })
            .catch(err => { console.error(err); alert('Network error — could not approve resource.'); });
    }

    function processReject(reason) {
        if (!currentReviewId) return;
        authFetch(API_BASE + '/admin/moderation/' + currentReviewId + '/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason }),
        })
            .then(res => res.json())
            .then(data => {
                if (!data.success) { alert(data.message || 'Could not reject resource.'); return; }
                closeAllModals();
                loadQueue().then(maybeOpenNextItem);
            })
            .catch(err => { console.error(err); alert('Network error — could not reject resource.'); });
    }

    // Called after a successful approve/reject refreshes the queue — see
    // "Auto-open Next Resource" in admin-settings.html's Moderation
    // Preferences.
    function maybeOpenNextItem() {
        const shouldAutoOpen = adminPreferences.moderation && adminPreferences.moderation.autoOpenNext;
        if (shouldAutoOpen && pendingQueue.length > 0) {
            window.openPreview(pendingQueue[0].id);
        }
    }

    document.getElementById('confirmApprove').addEventListener('click', processApprove);

    document.getElementById('confirmReject').addEventListener('click', () => {
        const selectedReason = document.querySelector('input[name="reason"]:checked');
        if(!selectedReason) {
            alert('Please select a rejection reason.');
            return;
        }
        // The reason-selection modal itself can't be skipped — a reason is
        // always required — but "Confirm Before Rejection" (on by default,
        // see admin-settings.html) adds one more explicit "are you sure"
        // step on top of it.
        const requireExtraConfirm = !adminPreferences.moderation || adminPreferences.moderation.confirmBeforeRejection !== false;
        if (requireExtraConfirm && !confirm('Reject this resource? This cannot be undone.')) {
            return;
        }
        processReject(selectedReason.value);
    });

    // Sticky Action Bar in Preview Modal
    document.getElementById('btnPreviewApprove').addEventListener('click', () => {
        requestApprove(currentReviewId);
    });

    document.getElementById('btnPreviewReject').addEventListener('click', () => {
        rejectModal.classList.remove('hidden');
    });

    // Keyboard Shortcuts (Only active when Preview Modal is open)
    document.addEventListener('keydown', (e) => {
        if (!previewModal.classList.contains('hidden') && approveModal.classList.contains('hidden') && rejectModal.classList.contains('hidden')) {
            if (e.key.toLowerCase() === 'a') {
                e.preventDefault();
                approveModal.classList.remove('hidden');
            }
            if (e.key.toLowerCase() === 'r') {
                e.preventDefault();
                rejectModal.classList.remove('hidden');
            }
        }
    });

    function updateStatsUI() {
        statPending.textContent = stats.pending;
        if (statPendingCard) statPendingCard.textContent = stats.pending;
        statApproved.textContent = stats.approvedToday;
        statRejected.textContent = stats.rejectedToday;
        if (sidebarQueueCount) sidebarQueueCount.textContent = stats.pending;

        const statTotalResources = document.getElementById('statTotalResources');
        if (statTotalResources) {
            statTotalResources.textContent = (stats.pending + stats.approved + stats.rejected).toLocaleString();
        }

        const total = stats.pending + stats.approved + stats.rejected;
        const pct = total > 0 ? Math.round((stats.pending / total) * 100) : 0;
        if (queueHealthRing) queueHealthRing.style.setProperty('--pct', pct);
        if (queueHealthRingLabel) queueHealthRingLabel.textContent = stats.pending;
    }

    // MOBILE NAVIGATION (HAMBURGER MENU) LOGIC
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const sidebar = document.getElementById('sidebar');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const scrim = document.getElementById('scrim');

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

    if (hamburgerBtn) hamburgerBtn.addEventListener('click', openSidebar);
    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
    if (scrim) scrim.addEventListener('click', closeSidebar);

    // ACCOUNT MENU (PROFILE ICON) DROPDOWN LOGIC
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

    const sortQueueSelect = document.getElementById('sortQueue');
    if (sortQueueSelect) sortQueueSelect.addEventListener('change', () => {
        currentPage = 1;
        loadQueue();
    });

    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    if (prevPageBtn) prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) { currentPage -= 1; loadQueue(); }
    });
    if (nextPageBtn) nextPageBtn.addEventListener('click', () => {
        currentPage += 1;
        loadQueue();
    });

    // Init — load this admin's own preferences first, since defaultSort
    // and itemsPerPage need to be applied before the very first fetch,
    // not after.
    loadAdminPreferences().then(() => {
        if (sortQueueSelect && adminPreferences.review && adminPreferences.review.defaultSort) {
            sortQueueSelect.value = adminPreferences.review.defaultSort;
        }
        loadQueue();
    });
});
