document.addEventListener('DOMContentLoaded', () => {

    // Realistic data reflecting a Computer Science curriculum
    const mockNotes = [
        { id: 1, title: "Introduction to Java Programming", course: "CSC 201", dept: "Computer Science", level: "200", semester: "First", pages: 42, size: "3.1 MB", downloads: 1246, date: "2 weeks ago", type: "PDF", popular: true },
        { id: 2, title: "Object-Oriented Concepts in Java", course: "CSC 201", dept: "Computer Science", level: "200", semester: "First", pages: 28, size: "1.8 MB", downloads: 850, date: "1 month ago", type: "PDF", popular: false },
        { id: 3, title: "Data Structures - Linked Lists & Trees", course: "CSC 202", dept: "Computer Science", level: "200", semester: "Second", pages: 55, size: "4.2 MB", downloads: 1050, date: "3 weeks ago", type: "PDF", popular: true },
        { id: 4, title: "Calculus Fundamentals", course: "MTH 101", dept: "Mathematics", level: "100", semester: "First", pages: 12, size: "1.1 MB", downloads: 430, date: "2 months ago", type: "DOCX", popular: false },
        { id: 5, title: "Software Engineering Principles", course: "CSC 301", dept: "Computer Science", level: "300", semester: "First", pages: 34, size: "2.5 MB", downloads: 620, date: "1 week ago", type: "PDF", popular: false }
    ];

    // Inline SVG markup used in place of emoji icons, matching the app-wide stroke-icon set
    const DOC_ICON_SVG = `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`;

    // Tiered pricing: 1-5 pages flat ₦200; 6-24 pages add ₦20/page; 25+
    // pages add ₦10/page. Kept in sync with the backend's utils/pricing.js —
    // the server always computes the real charge independently, this is
    // purely for accurate display before the user confirms payment.
    function calculateResourceCost(pages) {
        if (pages <= 5) return 200;
        if (pages <= 24) return 200 + (pages - 5) * 20;
        return 580 + (pages - 24) * 10;
    }
    function getResourceCost(note) {
        return calculateResourceCost(note.pages);
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

    // Initial Load
    renderSkeletons();
    setTimeout(applyFiltersAndRender, 800);

    function triggerSimulatedLoad() {
        container.classList.add('hidden');
        emptyState.classList.add('hidden');
        courseHighlightArea.classList.add('hidden');
        resultsHeader.innerHTML = '';
        renderSkeletons();
        setTimeout(applyFiltersAndRender, 500);
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
        if(sort === 'newest' || sort === 'updated') filtered.sort((a,b) => a.id - b.id); // Mock sorting

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
            const popularNote = data.find(n => n.course === targetCourse && n.popular) || data[0];
            
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

    let lastFocusedTrigger = null;
    let currentPreviewNote = null; // tracked so the modal's Download button knows what to charge for

    function openPreviewModal(note, triggerEl) {
        previewModalTitle.textContent = note.title;
        previewModalType.textContent = note.type;
        previewModalSize.textContent = note.size;
        previewModalCourse.textContent = note.course;
        previewModalSemester.textContent = note.semester;
        previewModalPages.textContent = `${note.pages} Pages`;
        previewModalDownloads.textContent = note.downloads;
        previewModalDownload.textContent = `Download · ${window.SharefWallet.formatNaira(getResourceCost(note))}`;

        currentPreviewNote = note;
        lastFocusedTrigger = triggerEl || null;
        previewModalOverlay.classList.add('is-open');
        previewModalOverlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        previewModalClose.focus();
    }

    function closePreviewModal() {
        previewModalOverlay.classList.remove('is-open');
        previewModalOverlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (lastFocusedTrigger) lastFocusedTrigger.focus();
    }

    // Runs the wallet charge, then a success callback if funds were enough.
    // The wallet itself opens the Insufficient Balance modal when they're
    // not, so callers just need to stop the download when this returns false.
    function attemptDownload(note, onSuccess) {
        const cost = getResourceCost(note);
        const charged = window.SharefWallet.charge(cost, `${note.course} — ${note.title}`);
        if (!charged) return;
        window.SharefWallet.showToast(`${window.SharefWallet.formatNaira(cost)} deducted · "${note.title}" download started.`);
        if (onSuccess) onSuccess();
    }

    // Delegated listener: covers cards in #notesContainer AND the
    // highlighted "most popular" card injected into #courseHighlightArea.
    document.addEventListener('click', (e) => {
        const previewBtn = e.target.closest('.btn-preview');
        if (previewBtn) {
            const card = previewBtn.closest('.note-card');
            const noteId = card ? Number(card.dataset.noteId) : null;
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
            const noteId = card ? Number(card.dataset.noteId) : null;
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
