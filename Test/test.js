document.addEventListener('DOMContentLoaded', function () {
    
    // ==========================================================================
    // 1. MOBILE DRAWER NAVIGATION PANEL CONTROLS
    // ==========================================================================
    var sidebar = document.getElementById('sidebar');
    var scrim = document.getElementById('scrim');
    var openBtn = document.getElementById('hamburgerBtn');
    var closeBtn = document.getElementById('sidebarCloseBtn');

    function openSidebar() {
        sidebar.classList.add('is-open');
        scrim.classList.add('is-visible');
        openBtn.setAttribute('aria-expanded', 'true');
        closeBtn.focus();
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        sidebar.classList.remove('is-open');
        scrim.classList.remove('is-visible');
        openBtn.setAttribute('aria-expanded', 'false');
        openBtn.focus();
        document.body.style.overflow = '';
    }

    if (openBtn && closeBtn && scrim) {
        openBtn.addEventListener('click', openSidebar);
        closeBtn.addEventListener('click', closeSidebar);
        scrim.addEventListener('click', closeSidebar);
    }

    // ==========================================================================
    // 2. SEARCH ARCHITECTURE & MOBILE OVERLAY LOGIC
    // ==========================================================================
    var searchWrapper = document.getElementById('searchWrapper');
    var searchInput = document.getElementById('searchInput');
    var mobileSearchTrigger = document.getElementById('mobileSearchTrigger');
    var mobileSearchClose = document.getElementById('mobileSearchClose');
    
    var discoveryState = document.getElementById('searchDiscoveryState');
    var resultsState = document.getElementById('searchResultsState');
    var resourceContainer = document.getElementById('resourceResultsContainer');
    var courseContainer = document.getElementById('courseResultsContainer');

    // Local Mock Database for Real-Time Suggestion Queries
    var mockDatabase = {
        resources: [
            { title: "CSC 201 Data Structures Notes", tag: "CSC 201" },
            { title: "CSC 202 Object Oriented Slides", tag: "CSC 202" },
            { title: "Database Systems Summary", tag: "CSC 311" },
            { title: "Operating Systems Blueprint Exam Pack", tag: "CSC 204" }
        ],
        courses: [
            { name: "CSC 201 Data Structures & Algorithms" },
            { name: "CSC 202 Object Oriented Programming" },
            { name: "MTH 202 Linear Algebra" }
        ]
    };

    // Show/Hide focus behaviors
    if (searchInput) {
        searchInput.addEventListener('focus', function() {
            searchWrapper.classList.add('focused');
        });
    }

    // Click outside search shell hides dropdown cleanly
    document.addEventListener('click', function(e) {
        if (searchWrapper && !searchWrapper.contains(e.target) && !mobileSearchTrigger.contains(e.target)) {
            searchWrapper.classList.remove('focused');
        }
    });

    // Mobile Search Activation Overlay Toggles
    if (mobileSearchTrigger) {
        mobileSearchTrigger.addEventListener('click', function() {
            searchWrapper.classList.add('mobile-active', 'focused');
            searchInput.focus();
        });
    }

    if (mobileSearchClose) {
        mobileSearchClose.addEventListener('click', function() {
            searchWrapper.classList.remove('mobile-active', 'focused');
            searchInput.value = '';
            toggleSearchState('');
        });
    }

    // Grouped Live Query Mapping Engine
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            var query = e.target.value.trim().toLowerCase();
            toggleSearchState(query);
        });
    }

    function toggleSearchState(query) {
        if (!query) {
            discoveryState.classList.remove('hidden');
            resultsState.classList.add('hidden');
            return;
        }

        discoveryState.classList.add('hidden');
        resultsState.classList.remove('hidden');

        // Filter database categories 
        var filteredResources = mockDatabase.resources.filter(function(item) {
            return item.title.toLowerCase().includes(query) || item.tag.toLowerCase().includes(query);
        });

        var filteredCourses = mockDatabase.courses.filter(function(item) {
            return item.name.toLowerCase().includes(query);
        });

        // Update UI View Injection
        resourceContainer.innerHTML = filteredResources.length ? filteredResources.map(function(r) {
            return `<div class="search-result-row"><span>${r.title}</span><span class="meta-tag">${r.tag}</span></div>`;
        }).join('') : `<div style="font-size:0.78rem; padding: 0.5rem; color:var(--text-muted)">No resources match your search term.</div>`;

        courseContainer.innerHTML = filteredCourses.length ? filteredCourses.map(function(c) {
            return `<div class="search-result-row"><span>${c.name}</span></div>`;
        }).join('') : `<div style="font-size:0.78rem; padding: 0.5rem; color:var(--text-muted)">No matching courses.</div>`;
    }

    // Capture pill values click directly inside suggestions
    document.querySelectorAll('.search-pill-item').forEach(function(pill) {
        pill.addEventListener('click', function() {
            var val = pill.textContent.replace('🔥', '').trim();
            searchInput.value = val;
            toggleSearchState(val.toLowerCase());
        });
    });

    // Universal keyboard listeners (⌘K or Ctrl+K focus)
    document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            if (window.innerWidth <= 860) {
                searchWrapper.classList.add('mobile-active');
            }
            searchWrapper.classList.add('focused');
            searchInput.focus();
        }
        if (e.key === 'Escape' && searchWrapper.classList.contains('focused')) {
            searchWrapper.classList.remove('focused', 'mobile-active');
            searchInput.blur();
        }
    });

    // ==========================================================================
    // 3. TOAST NOTIFICATION MICRO-SYSTEM (Downloads/Bookmarks)
    // ==========================================================================
    var toastContainer = document.getElementById('toastContainer');

    function launchToast(title, description, isSuccess) {
        if (!toastContainer) return;
        
        var toast = document.createElement('div');
        toast.className = `toast-item ${isSuccess ? 'success-variant' : ''}`;
        toast.innerHTML = `
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${description}</div>
        `;
        
        toastContainer.appendChild(toast);
        
        // Remove from memory stack automatically after timeout loop completes
        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(function() { toast.remove(); }, 300);
        }, 4000);
    }

    // Attach event captures out into structural context targets
    document.addEventListener('click', function(e) {
        var downloadTarget = e.target.closest('.trigger-download');
        var bookmarkTarget = e.target.closest('.trigger-bookmark');
        var genericToast = e.target.closest('.trigger-toast');

        if (downloadTarget) {
            var fileName = downloadTarget.getAttribute('data-title') || 'Resource file';
            launchToast('✓ Download started', fileName, true);
        }
        else if (bookmarkTarget) {
            var titleName = bookmarkTarget.getAttribute('data-title') || 'Item';
            launchToast('🔖 Bookmark updated', `${titleName} has been saved.`, false);
        }
        else if (genericToast) {
            var msg = genericToast.getAttribute('data-toast') || 'Action registered.';
            launchToast('Notification', msg, false);
        }
    });

    // ==========================================================================
    // 4. "SEE MORE" RECENT FEED STACK OVERFLOW
    // ==========================================================================
    var recentFeedStack = document.getElementById('recentFeedStack');
    var feedMoreBtn = document.getElementById('feedMoreBtn');

    var additionalItems = [
        { title: "CSC 204 Computer Architecture Notes", meta: "Added 5 days ago • PDF Document" },
        { title: "MTH 202 Linear Algebra Blueprint", meta: "Added 1 week ago • Revision Sheet" }
    ];

    additionalItems.forEach(function(item) {
        var itemEl = document.createElement('div');
        itemEl.className = 'feed-item hidden';
        itemEl.innerHTML = `
            <div class="item-info">
                <h3>${item.title}</h3>
                <p>${item.meta}</p>
            </div>
            <div class="item-control-links">
                <button class="feed-inline-link trigger-download" data-title="${item.title}.pdf">Download</button>
                <a href="#" class="feed-inline-link">Preview</a>
            </div>
        `;
        recentFeedStack.appendChild(itemEl);
    });

    if (feedMoreBtn) {
        feedMoreBtn.addEventListener('click', function() {
            var hiddenItems = recentFeedStack.querySelectorAll('.feed-item.hidden');
            var allItems = recentFeedStack.querySelectorAll('.feed-item');
            var labelSpan = feedMoreBtn.querySelector('span');

            if (hiddenItems.length > 0) {
                hiddenItems.forEach(function(el) { el.classList.remove('hidden'); });
                labelSpan.textContent = "See less updates";
                feedMoreBtn.classList.add('expanded');
            } else {
                allItems.forEach(function(el, index) {
                    if (index >= 2) el.classList.add('hidden');
                });
                labelSpan.textContent = "See more updates";
                feedMoreBtn.classList.remove('expanded');
            }
        });
    }
});