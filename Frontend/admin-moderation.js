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

            let rewardBadgeHTML = '';
            if (item.bounty) rewardBadgeHTML += '<span class="rw-q-badge">Requested \u00b7 ' + naira(item.bounty.reward) + '</span>';
            if (item.uploaderRisk && item.uploaderRisk.level !== 'low') rewardBadgeHTML += '<span class="rw-q-badge risk">' + (item.uploaderRisk.level === 'high' ? 'High risk uploader' : 'Review uploader') + '</span>';

            card.innerHTML = `
                <div class="q-left">
                    ${agedBadgeHTML}${rewardBadgeHTML}
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

        loadReview(id)
            .then(({ analysis, fileUrl }) => {
                if (currentReviewId !== id) return; // modal moved on to something else

                if (analysis.ok && analysis.fullText) {
                    placeholderEl.classList.add('hidden');
                    fullTextEl.classList.remove('hidden');
                    fullTextEl.textContent = analysis.fullText;
                } else {
                    // Nothing readable inline (scan, zip, image, or unreadable):
                    // just the message plus a free download to review.
                    textEl.textContent = analysis.message || 'Preview not available for this file type.';
                }

                if (fileUrl) {
                    downloadBtn.href = fileUrl;
                    downloadBtn.classList.remove('hidden');
                }
            })
            .catch(() => {
                if (currentReviewId !== id) return;
                textEl.textContent = 'Preview not available right now.';
            });
    };

    // ------------------------------------------------------------------
    // Review-time analysis. The server can't parse documents (free-plan CPU
    // limit), so this browser counts the pages and extracts the preview text
    // (doc-analyzer.js) and submits them when the admin approves.
    // ------------------------------------------------------------------
    const analysisCache = {}; // resource id -> analysis (the signed link is NOT cached: it expires in 2 min)

    function loadReview(id) {
        return authFetch(API_BASE + '/admin/moderation/' + id + '/preview')
            .then(res => res.json())
            .then(data => {
                if (!data.success) throw new Error(data.message || 'preview failed');
                if (analysisCache[id]) return { analysis: analysisCache[id], fileUrl: data.fileUrl };
                return DocAnalyzer.analyze(data.fileUrl, data.fileName).then(analysis => {
                    analysisCache[id] = analysis;
                    return { analysis, fileUrl: data.fileUrl };
                });
            })
            .catch(() => ({
                analysis: { ok: false, pages: null, fullText: '', snippet: '', message: 'Could not load the file for analysis — enter the page count manually.' },
                fileUrl: null,
            }));
    }

    window.quickApprove = (id) => {
        requestApprove(id);
    };

    const approvePagesInput = document.getElementById('approvePages');
    const approvePagesNote = document.getElementById('approvePagesNote');
    const confirmApproveBtn = document.getElementById('confirmApprove');

    // Opens the Approve modal and fills the page count once analysis finishes.
    function showApproveModal() {
        const id = currentReviewId;
        fillRewardPanel(id);
        approveModal.classList.remove('hidden');
        approvePagesInput.value = '';
        approvePagesInput.disabled = true;
        confirmApproveBtn.disabled = true;
        approvePagesNote.classList.remove('warn');
        approvePagesNote.textContent = 'Counting pages…';

        loadReview(id).then(({ analysis }) => {
            if (currentReviewId !== id) return;
            approvePagesInput.disabled = false;
            confirmApproveBtn.disabled = false;
            if (analysis.ok) {
                approvePagesInput.value = analysis.pages;
                approvePagesNote.textContent = analysis.message || 'Detected automatically — correct it if it looks wrong. This sets the price students pay.';
            } else {
                approvePagesNote.classList.add('warn');
                approvePagesNote.textContent = analysis.message || 'Enter the page count manually.';
                approvePagesInput.focus();
            }
        });
    }

    function requestApprove(id) {
        currentReviewId = id;
        fillRewardPanel(id);
        const reviewItem = pendingQueue.find(i => i.id === id);
        // Requested resources and risky uploaders always get the dialog, even if
        // the moderator turned confirmations off.
        const skipConfirm = adminPreferences.moderation && adminPreferences.moderation.confirmBeforeApproval === false
            && !itemNeedsRewardReview(reviewItem);
        if (!skipConfirm) {
            showApproveModal();
            return;
        }
        // No confirmation wanted: analyse, and approve straight away if the
        // count was read reliably. If it wasn't, fall back to the modal so the
        // admin can type it in.
        document.body.style.cursor = 'progress';
        loadReview(id).then(({ analysis }) => {
            document.body.style.cursor = '';
            if (currentReviewId !== id) return;
            if (analysis.ok) processApprove(analysis.pages, analysis.snippet, analysis.fileHash);
            else showApproveModal();
        });
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
        if (currentReviewId) delete analysisCache[currentReviewId];
        currentReviewId = null;
    }

    // ------------------------------------------------------------------
    // Incentive rewards (see admin-incentives.html). Everything here is
    // optional: if the program is off, or the endpoint doesn't exist yet,
    // rewardCfg stays null and approving works exactly as it always did.
    // The server decides the payout; this only lets a moderator pick a
    // tier and see the warnings the server attached to the item.
    // ------------------------------------------------------------------
    let rewardCfg = null;
    function naira(n) { return '\u20A6' + Math.round(Number(n) || 0).toLocaleString('en-NG'); }

    function loadRewardConfig() {
        return authFetch(API_BASE + '/admin/incentives/config')
            .then(res => res.json())
            .then(data => { rewardCfg = data.success && data.status !== 'off' ? data : null; })
            .catch(() => { rewardCfg = null; });
    }
    loadRewardConfig();

    function rewardsLive() { return !!rewardCfg && rewardCfg.status === 'live'; }

    function itemNeedsRewardReview(item) {
        return rewardsLive() && !!item && (!!item.bounty || (item.uploaderRisk && item.uploaderRisk.level !== 'low'));
    }

    function fillRewardPanel(id) {
        const panel = document.getElementById('approveRewardPanel');
        const item = pendingQueue.find(i => i.id === id);
        if (!panel) return;
        if (!rewardCfg || !item) { panel.classList.add('hidden'); return; }

        const tiers = rewardCfg.rewards || {};
        const opts = [];
        if (item.bounty) opts.push(['bounty', 'Requested resource \u2014 ' + naira(item.bounty.reward)]);
        opts.push(['standard', 'Standard \u2014 ' + naira(item.type === 'Past Question' ? tiers.pastQuestion : tiers.lectureNote)]);
        opts.push(['high', 'High-value \u2014 ' + naira(tiers.high)]);
        opts.push(['rare', 'Rare (not on Sharef yet) \u2014 ' + naira(tiers.rare)]);
        opts.push(['none', 'No reward']);
        const sel = document.getElementById('approveRewardTier');
        sel.innerHTML = opts.map(o => '<option value="' + o[0] + '">' + escapeHtml(o[1]) + '</option>').join('');
        sel.value = item.bounty ? 'bounty' : 'standard';
        document.getElementById('approveRewardNote').value = '';

        const hint = document.getElementById('approveRewardHint');
        const rp = item.rewardPreview;
        hint.textContent = rewardsLive()
            ? (rp && rp.blocked ? 'No reward will be paid: ' + rp.blockReason : 'The server applies weekly caps, the monthly budget and any first-upload bonus on top of this.')
            : rewardCfg.status === 'shadow'
                ? 'Shadow mode: the reward is recorded as a projection only. No money moves.'
                : 'Rewards are paused. The upload is approved and no reward is paid.';

        const risk = document.getElementById('approveRiskNote');
        const r = item.uploaderRisk;
        if (r && r.level !== 'low') {
            risk.innerHTML = '<strong>' + (r.level === 'high' ? 'High risk uploader' : 'Check before paying') + '</strong>' +
                (r.notes || []).map(n => '<span>' + escapeHtml(n) + '</span>').join('');
            risk.classList.remove('hidden');
        } else risk.classList.add('hidden');
        panel.classList.remove('hidden');
    }

    function collectRewardChoice() {
        const panel = document.getElementById('approveRewardPanel');
        if (!panel || panel.classList.contains('hidden')) return null;
        const tier = document.getElementById('approveRewardTier').value;
        const note = document.getElementById('approveRewardNote').value.trim();
        if ((tier === 'high' || tier === 'rare') && note.length < 5) {
            alert('Add a short reason for a ' + (tier === 'high' ? 'High-value' : 'Rare') + ' reward. It is recorded in the audit log.');
            return false;
        }
        return { rewardTier: tier, rewardNote: note };
    }

    // Small non-blocking message (the approval dialog has already closed). Used to tell the moderator what
    // happened with the reward, e.g. "Reward of ₦150 recorded" or "No reward paid: Weekly cap reached".
    function showApprovalNote(text, isWarning) {
        var old = document.getElementById('rwApprovalNote');
        if (old) old.remove();
        var el = document.createElement('div');
        el.id = 'rwApprovalNote';
        el.className = 'rw-approval-note' + (isWarning ? ' warn' : '');
        el.setAttribute('role', 'status');
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.remove(); }, 6000);
    }

    function processApprove(pages, snippet, fileHash) {
        if (!currentReviewId) return;
        const choice = collectRewardChoice();
        if (choice === false) return; // reward tier needs a reason; alert already shown
        const payload = { pages: pages, snippet: snippet || '' };
        if (choice) Object.assign(payload, choice);
        if (fileHash) payload.fileHash = fileHash; // lets the server spot duplicate uploads
        authFetch(API_BASE + '/admin/moderation/' + currentReviewId + '/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(res => res.json())
            .then(data => {
                if (!data.success) { alert(data.message || 'Could not approve resource.'); return; }
                closeAllModals();
                // Only present when the reward program is on: tell the moderator what happened with the reward.
                if (data.reward && data.reward.message) showApprovalNote(data.message, data.reward.status === 'blocked' || data.reward.status === 'error');
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

    confirmApproveBtn.addEventListener('click', () => {
        const pages = Number(approvePagesInput.value);
        if (!Number.isInteger(pages) || pages < 1 || pages > 1000) {
            approvePagesNote.classList.add('warn');
            approvePagesNote.textContent = 'Enter a whole number of pages from 1 to 1000.';
            approvePagesInput.focus();
            return;
        }
        const cached = analysisCache[currentReviewId];
        processApprove(pages, cached && cached.ok ? cached.snippet : '', cached && cached.fileHash);
    });

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
                showApproveModal();
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
