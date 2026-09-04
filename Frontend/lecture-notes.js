document.addEventListener('DOMContentLoaded', () => {

    // Real data — fetched from GET /api/resources?type=Lecture Note
    let mockNotes = [];

    function timeAgoLabel(isoDate) {
        const diffMs = Date.now() - new Date(isoDate).getTime();
        const mins = Math.floor(diffMs / 60000);
        const hours = Math.floor(diffMs / 3600000);
        const days = Math.floor(diffMs / 86400000);
        if (mins < 60) return mins <= 1 ? "Just now" : `${mins} minutes ago`;
        if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
        if (days === 1) return "Yesterday";
        if (days < 30) return `${days} days ago`;
        const months = Math.floor(days / 30);
        return months === 1 ? "1 month ago" : `${months} months ago`;
    }

    // Backend has no per-resource "popular" flag — the course highlight
    // banner instead picks whichever note in that course has the most
    // downloads (see updateHeaders below).
    function transformResource(r) {
        return {
            id: r.id,
            title: r.title,
            course: r.course,
            dept: r.department,
            level: r.level,
            semester: r.semester,
            pages: r.pages,
            size: r.size,
            downloads: r.downloads,
            date: timeAgoLabel(r.createdAt),
            createdAt: r.createdAt,
            type: (r.fileExtension || "").toUpperCase(),
        };
    }

    async function fetchAllLectureNotes() {
        let all = [];
        let page = 1;
        let totalPages = 1;
        do {
            const res = await authFetch(`${API_BASE}/resources?type=${encodeURIComponent("Lecture Note")}&page=${page}&limit=50`);
            const data = await res.json();
            if (!data.success) break;
            all = all.concat(data.resources.map(transformResource));
            totalPages = data.totalPages || 1;
            page += 1;
        } while (page <= totalPages && page <= 10);
        return all;
    }

    // Inline SVG markup used in place of emoji icons, matching the app-wide stroke-icon set
    const DOC_ICON_SVG = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`;

    // Pricing mirrors the backend's tiered formula (utils/pricing.js) via
    // the shared window.SharefWallet.calculateCost helper in dashboard.js,
    // so the price shown here matches what the download modal will
    // actually charge — a flat ₦10/page estimate used to live here and
    // under-priced anything under 25 pages.
    function getResourceCost(note) {
        return window.SharefWallet.calculateCost(note.pages);
    }

    // DOM Elements
    const container = document.getElementById('notesContainer');
    const skeletonContainer = document.getElementById('skeletonContainer');
    const emptyState = document.getElementById('emptyState');
    const resultsHeader = document.getElementById('resultsHeader');
    const courseHighlightArea = document.getElementById('courseHighlightArea');
    
    // Filters
    const searchInput = document.getElementById('notesSearch');
    const deptFilter = document.getElementById('deptFilter');
    const levelFilter = document.getElementById('levelFilter');
    const semesterFilter = document.getElementById('semesterFilter');
    const courseFilter = document.getElementById('courseFilter');
    const sortOrder = document.getElementById('sortOrder');
    const quickFilters = document.querySelectorAll('.qf-btn');
    // Department/course lists grow with real adoption, so both use the
    // searchable combobox instead of a plain <select> — see
    // searchable-select.js. Level/Semester stay plain selects; they're
    // small, fixed enums that will never need searching.
    const deptFilterEnhanced = new SearchableSelect(deptFilter, { placeholder: 'Search departments…' });
    const courseFilterEnhanced = new SearchableSelect(courseFilter, { placeholder: 'Search courses…' });

    // Mobile Sheet
    const mobileFilterToggle = document.getElementById('mobileFilterToggle');
    const filterPanel = document.getElementById('filterPanel');
    const closeFilters = document.getElementById('closeFilters');

    // Event Listeners for Filters
    [searchInput, deptFilter, levelFilter, semesterFilter, courseFilter, sortOrder].forEach(el => {
        el.addEventListener('input', triggerSimulatedLoad);
    });

    quickFilters.forEach(btn => {
        btn.addEventListener('click', (e) => {
            quickFilters.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            levelFilter.value = e.target.dataset.level;
            triggerSimulatedLoad();
        });
    });

    // Mobile Filter Logic
    mobileFilterToggle.addEventListener('click', () => filterPanel.classList.add('open'));
    closeFilters.addEventListener('click', () => filterPanel.classList.remove('open'));

    // Department is free text at profile-edit time, not a fixed enum, so —
    // same reasoning as courses — both option lists are built from
    // whatever actually shows up in the fetched notes, letting the
    // searchable filters stay useful as more departments/courses appear
    // with real adoption, instead of the fixed few baked into the HTML.
    function populateDeptOptions() {
        const departments = Array.from(new Set(mockNotes.map(n => n.dept).filter(Boolean))).sort();
        const currentValue = deptFilter.value;

        deptFilter.innerHTML = '<option value="all">All Departments</option>';
        departments.forEach(dept => {
            const opt = document.createElement('option');
            opt.value = dept;
            opt.textContent = dept;
            deptFilter.appendChild(opt);
        });
        const stillValid = Array.from(deptFilter.options).some(opt => opt.value === currentValue);
        deptFilter.value = stillValid ? currentValue : 'all';
        deptFilterEnhanced.refresh();
    }

    function populateCourseOptions() {
        const courses = Array.from(new Set(mockNotes.map(n => n.course).filter(Boolean))).sort();
        const currentValue = courseFilter.value;

        courseFilter.innerHTML = '<option value="all">All Courses</option>';
        courses.forEach(course => {
            const opt = document.createElement('option');
            opt.value = course;
            opt.textContent = course;
            courseFilter.appendChild(opt);
        });
        const stillValid = Array.from(courseFilter.options).some(opt => opt.value === currentValue);
        courseFilter.value = stillValid ? currentValue : 'all';
        courseFilterEnhanced.refresh();
    }

    // Pre-fills department/level from the user's completed profile — the
    // payoff for completing the "Add your department" banner. Department is
    // free-text at profile-edit time, so a matching <option> is added on the
    // fly if it isn't already one the notes data produced.
    async function fetchProfile() {
        try {
            const res = await authFetch(`${API_BASE}/users/me`);
            const data = await res.json();
            return data.success ? data.user : null;
        } catch (err) {
            console.error('Could not load profile for filter prefill:', err);
            return null;
        }
    }

    function applyProfilePrefill(profile) {
        if (!profile) return;

        if (profile.department) {
            const hasOption = Array.from(deptFilter.options).some(opt => opt.value === profile.department);
            if (!hasOption) {
                const opt = document.createElement('option');
                opt.value = profile.department;
                opt.textContent = profile.department;
                deptFilter.appendChild(opt);
            }
            deptFilter.value = profile.department;
            deptFilterEnhanced.refresh();
        }
        if (profile.level) {
            levelFilter.value = profile.level;
        }
    }

    // Initial Load — fetch real Lecture Note resources once, then filter/
    // sort/render entirely client-side (same pipeline as before, just fed
    // with real data instead of a fixed mock array).
    renderSkeletons();
    Promise.all([fetchAllLectureNotes(), fetchProfile()])
        .then(([notes, profile]) => {
            mockNotes = notes;
            populateDeptOptions();
            populateCourseOptions();
            applyProfilePrefill(profile); // runs after populate, so its added option/selection survives
            applyFiltersAndRender();
        })
        .catch(err => {
            console.error(err);
            skeletonContainer.classList.add('hidden');
            resultsHeader.textContent = 'Could not load lecture notes.';
            emptyState.classList.remove('hidden');
        });

    function triggerSimulatedLoad() {
        container.classList.add('hidden');
        emptyState.classList.add('hidden');
        courseHighlightArea.classList.add('hidden');
        resultsHeader.innerHTML = '';
        renderSkeletons();
        setTimeout(applyFiltersAndRender, 300);
    }

    function renderSkeletons() {
        skeletonContainer.innerHTML = '';
        skeletonContainer.classList.remove('hidden');
        for(let i=0; i<6; i++) {
            skeletonContainer.innerHTML += `
                <div class="note-card">
                    <div class="skeleton sk-title"></div>
                    <div class="skeleton sk-meta" style="width: 40%"></div>
                    <div class="skeleton sk-meta"></div>
                    <div style="display:flex; gap:0.5rem; margin-top:2rem;">
                        <div class="skeleton sk-btn"></div>
                        <div class="skeleton sk-btn"></div>
                    </div>
                </div>
            `;
        }
    }

    function applyFiltersAndRender() {
        skeletonContainer.classList.add('hidden');
        
        const query = searchInput.value.toLowerCase().trim();
        const selectedDept = deptFilter.value;
        const selectedLevel = levelFilter.value;
        const selectedSemester = semesterFilter.value;
        const selectedCourse = courseFilter.value;
        const sort = sortOrder.value;

        let filtered = mockNotes.filter(note => {
            const matchSearch = note.title.toLowerCase().includes(query) || note.course.toLowerCase().includes(query);
            const matchDept = selectedDept === 'all' || note.dept === selectedDept;
            const matchLevel = selectedLevel === 'all' || note.level === selectedLevel;
            const matchSem = selectedSemester === 'all' || note.semester === selectedSemester;
            const matchCourse = selectedCourse === 'all' || note.course === selectedCourse;
            
            return matchSearch && matchDept && matchLevel && matchSem && matchCourse;
        });

        // Sorting Logic
        if(sort === 'downloads') filtered.sort((a,b) => b.downloads - a.downloads);
        if(sort === 'az') filtered.sort((a,b) => a.title.localeCompare(b.title));
        if(sort === 'newest' || sort === 'updated') filtered.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

        updateHeaders(filtered, selectedCourse, query, selectedDept);
        
        if (filtered.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }

        container.innerHTML = '';
        container.classList.remove('hidden');

        filtered.forEach(note => {
            container.appendChild(createNoteCard(note));
        });
    }

    function updateHeaders(data, course, query, dept) {
        // Course specific highlight logic
        if (course !== 'all' || (query.length > 5 && query.startsWith('csc'))) {
            const targetCourse = course !== 'all' ? course : query.toUpperCase();
            const courseNotes = data.filter(n => n.course === targetCourse).sort((a, b) => b.downloads - a.downloads);
            const popularNote = courseNotes[0] || data[0];
            
            if (popularNote && data.length > 0) {
                courseHighlightArea.innerHTML = `
                    <div class="course-info">
                        <h2>${popularNote.course}</h2>
                        <p>${popularNote.dept} • ${popularNote.level} Level • ${data.length} Lecture Notes Available</p>
                    </div>
                    <div class="popular-banner">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        Most Popular for this Course
                    </div>
                `;
                courseHighlightArea.appendChild(createNoteCard(popularNote));
                courseHighlightArea.classList.remove('hidden');
                
                resultsHeader.innerHTML = `Showing all notes for <span>${targetCourse}</span>`;
                return;
            }
        }

        // Standard Results Header
        let contextText = dept !== 'all' ? dept : "All Departments";
        resultsHeader.innerHTML = `Showing <span>${data.length} lecture notes</span> for <span>${contextText}</span>`;
    }

    function createNoteCard(note) {
        const div = document.createElement('div');
        div.className = 'note-card';
        div.dataset.noteId = note.id;
        div.innerHTML = `
            <div class="card-top">
                <span class="doc-type-icon">${DOC_ICON_SVG}</span>
                <div class="badges">
                    <span class="badge">${note.type}</span>
                    <span class="badge">${note.size}</span>
                </div>
            </div>
            <h3 class="note-title">${note.title}</h3>
            
            <div class="note-meta-grid">
                <div class="meta-item">
                    <span class="meta-label">Course</span>
                    <span class="meta-value">${note.course}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Semester</span>
                    <span class="meta-value">${note.semester}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Pages</span>
                    <span class="meta-value">${note.pages} Pages</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Downloads</span>
                    <span class="meta-value">${note.downloads}</span>
                </div>
                <div class="meta-item" style="grid-column: span 2;">
                    <span class="meta-label">Uploaded</span>
                    <span class="meta-value">${note.date}</span>
                </div>
            </div>

            <div class="card-actions">
                <button class="btn-action btn-preview">Preview</button>
                <button class="btn-action btn-download">Download &middot; ${window.SharefWallet.formatNaira(getResourceCost(note))}</button>
            </div>
        `;
        return div;
    }

    // ==========================================================================
    // PREVIEW MODAL
    // ==========================================================================
    const previewModalOverlay = document.getElementById('previewModalOverlay');
    const previewModal = document.getElementById('previewModal');
    const previewModalClose = document.getElementById('previewModalClose');
    const previewModalCloseSecondary = document.getElementById('previewModalCloseSecondary');
    const previewModalDownload = document.getElementById('previewModalDownload');
    const previewModalTitle = document.getElementById('previewModalTitle');
    const previewModalType = document.getElementById('previewModalType');
    const previewModalSize = document.getElementById('previewModalSize');
    const previewModalCourse = document.getElementById('previewModalCourse');
    const previewModalSemester = document.getElementById('previewModalSemester');
    const previewModalPages = document.getElementById('previewModalPages');
    const previewModalDownloads = document.getElementById('previewModalDownloads');
    const previewModalVisual = document.getElementById('previewModalVisual');
    const previewModalImage = document.getElementById('previewModalImage');
    const previewModalNote = document.getElementById('previewModalNote');

    let lastFocusedTrigger = null;
    let currentPreviewNote = null; // tracked so the modal's Download button knows what to charge for

    function resetPreviewDocPanel() {
        previewModalImage.classList.add('hidden', 'is-loading');
        previewModalImage.removeAttribute('src');
        previewModalVisual.classList.remove('hidden');
        previewModalNote.textContent = 'Loading preview…';
    }

    function showPreviewImage(imageUrl) {
        previewModalVisual.classList.add('hidden');
        previewModalNote.textContent = '';
        previewModalImage.classList.remove('hidden');
        previewModalImage.classList.add('is-loading'); // spinner-style fade until it loads
        previewModalImage.onload = () => previewModalImage.classList.remove('is-loading');
        previewModalImage.onerror = () => {
            previewModalImage.classList.add('hidden');
            previewModalVisual.classList.remove('hidden');
            previewModalNote.textContent = 'Preview not available right now.';
        };
        previewModalImage.src = imageUrl; // fetched from Cloudinary only when the modal opens
    }

    function showPreviewText(text) {
        previewModalNote.textContent = `"${text}"`;
    }

    function openPreviewModal(note, triggerEl) {
        previewModalTitle.textContent = note.title;
        previewModalType.textContent = note.type;
        previewModalSize.textContent = note.size;
        previewModalCourse.textContent = note.course;
        previewModalSemester.textContent = note.semester;
        previewModalPages.textContent = `${note.pages} Pages`;
        previewModalDownloads.textContent = note.downloads;
        previewModalDownload.textContent = `Download · ${window.SharefWallet.formatNaira(getResourceCost(note))}`;
        resetPreviewDocPanel();

        currentPreviewNote = note;
        lastFocusedTrigger = triggerEl || null;
        previewModalOverlay.classList.add('is-open');
        previewModalOverlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        previewModalClose.focus();

        authFetch(`${API_BASE}/resources/${note.id}/preview`)
            .then((res) => res.json())
            .then((data) => {
                if (currentPreviewNote !== note) return; // modal moved on to something else
                if (data.previewType === 'image') {
                    showPreviewImage(data.imageUrl);
                } else if (data.previewType === 'text') {
                    showPreviewText(data.snippet);
                } else {
                    previewModalNote.textContent = data.message || 'Preview not available for this file type.';
                }
            })
            .catch(() => {
                if (currentPreviewNote !== note) return;
                previewModalNote.textContent = 'Preview not available right now.';
            });
    }

    function closePreviewModal() {
        previewModalOverlay.classList.remove('is-open');
        previewModalOverlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (lastFocusedTrigger) lastFocusedTrigger.focus();
    }

    // Runs the wallet charge, then a success callback if funds were enough.
    function attemptDownload(note, onSuccess) {
        const cost = getResourceCost(note);
        window.SharefWallet.charge(note.id, `${note.course} — ${note.title}`, cost).then((data) => {
            if (!data.success) return;
            if (data.fileUrl) window.open(data.fileUrl, "_blank");
            window.SharefWallet.showToast(`${window.SharefWallet.formatNaira(data.amountCharged || cost)} deducted · "${note.title}" download started.`);
            if (onSuccess) onSuccess();
        });
    }

    // Delegated listener: covers cards in #notesContainer AND the
    // highlighted "most popular" card injected into #courseHighlightArea.
    document.addEventListener('click', (e) => {
        const previewBtn = e.target.closest('.btn-preview');
        if (previewBtn) {
            const card = previewBtn.closest('.note-card');
            const noteId = card ? card.dataset.noteId : null;
            const note = mockNotes.find(n => n.id === noteId);
            if (note) openPreviewModal(note, previewBtn);
            return;
        }

        // Card-level Download button — gated by the wallet balance. If funds
        // are insufficient, SharefWallet.charge() opens the Insufficient
        // Balance modal on its own and the download simply doesn't happen.
        const downloadBtn = e.target.closest('.btn-download');
        if (downloadBtn) {
            const card = downloadBtn.closest('.note-card');
            const noteId = card ? card.dataset.noteId : null;
            const note = mockNotes.find(n => n.id === noteId);
            if (note) attemptDownload(note);
        }
    });

    previewModalClose.addEventListener('click', closePreviewModal);
    previewModalCloseSecondary.addEventListener('click', closePreviewModal);
    previewModalDownload.addEventListener('click', () => {
        if (currentPreviewNote) {
            attemptDownload(currentPreviewNote, closePreviewModal);
        } else {
            closePreviewModal();
        }
    });

    previewModalOverlay.addEventListener('click', (e) => {
        if (e.target === previewModalOverlay) closePreviewModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && previewModalOverlay.classList.contains('is-open')) {
            closePreviewModal();
        }
    });
});
