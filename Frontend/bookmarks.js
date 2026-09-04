document.addEventListener('DOMContentLoaded', () => {
    if (!currentUser) return; // dashboard.js already ran requireAuth() at the top of the file

    // Real bookmarks, loaded from the server below.
    let savedBookmarks = [];

    // Filled bookmark icon used in place of the pin emoji, matching the app-wide icon set
    const UNPIN_ICON_SVG = `<svg fill="currentColor" stroke="none" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L7 21V5z"/></svg>`;

    const bookmarksGrid = document.getElementById('bookmarksGrid');
    const emptyState = document.getElementById('emptyState');
    const searchInput = document.getElementById('bookmarkSearch');
    const typeFilter = document.getElementById('typeFilter');

    function loadBookmarks() {
        bookmarksGrid.innerHTML = '<p class="bookmarks-loading">Loading your bookmarks…</p>';
        emptyState.classList.add('hidden');

        authFetch(API_BASE + '/bookmarks')
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    bookmarksGrid.innerHTML = '';
                    return;
                }
                savedBookmarks = data.resources;
                renderBookmarks();
            })
            .catch((err) => {
                console.error('Could not load bookmarks:', err);
                bookmarksGrid.innerHTML = '<p class="bookmarks-error">Could not load your bookmarks. Please refresh the page.</p>';
            });
    }

    loadBookmarks();

    // Event listeners for searching and filtering
    searchInput.addEventListener('input', renderBookmarks);
    typeFilter.addEventListener('change', renderBookmarks);

    function renderBookmarks() {
        bookmarksGrid.innerHTML = '';

        const searchQuery = searchInput.value.toLowerCase().trim();
        const selectedType = typeFilter.value;

        // Filtering calculation logic
        const filteredData = savedBookmarks.filter(item => {
            const matchesSearch = item.title.toLowerCase().includes(searchQuery) || item.course.toLowerCase().includes(searchQuery);
            const matchesType = selectedType === 'all' || item.type === selectedType;
            return matchesSearch && matchesType;
        });

        if (filteredData.length === 0) {
            bookmarksGrid.classList.add('hidden');
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        bookmarksGrid.classList.remove('hidden');

        // Dynamically build individual element blocks
        filteredData.forEach(item => {
            const card = document.createElement('div');
            card.className = 'bookmark-card';
            card.setAttribute('data-id', item.id);

            card.innerHTML = `
                <div class="card-body">
                    <h3 class="card-title">${item.title}</h3>
                    <p class="card-meta">${item.course} • ${item.type}</p>
                </div>
                <div class="card-actions">
                    <a href="#" class="btn-view">Open File &rarr;</a>
                    <button class="btn-unpin" title="Remove Bookmark" aria-label="Remove Bookmark">${UNPIN_ICON_SVG}</button>
                </div>
            `;

            // Opens the paid-download flow, same as every other resource card
            // in the app — the backend recomputes the real price from pages.
            card.querySelector('.btn-view').addEventListener('click', (e) => {
                e.preventDefault();
                openBookmark(item);
            });

            // Attach inline removal click tracking
            card.querySelector('.btn-unpin').addEventListener('click', () => {
                removeBookmark(item.id);
            });

            bookmarksGrid.appendChild(card);
        });
    }

    // Charges for (or free-redownloads) the resource, same flow used on the
    // dashboard and other browse pages — backend is the source of truth for
    // pricing and ownership.
    function openBookmark(item) {
        if (!window.SharefWallet) return;
        const cost = window.SharefWallet.calculateCost(item.pages);

        window.SharefWallet.charge(item.id, item.course + ' — ' + item.title, cost).then((data) => {
            if (!data.success) return; // charge() already surfaced the right modal/toast

            if (data.fileUrl) window.open(data.fileUrl, '_blank');

            window.SharefWallet.showToast(
                data.alreadyOwned
                    ? `"${item.title}" download started.`
                    : `${window.SharefWallet.formatNaira(data.amountCharged)} deducted · "${item.title}" download started.`
            );
        });
    }

    // Handles interactive element updates without complete page reloads.
    // Bookmarks share one toggle endpoint (POST = flip state) with the
    // "save" action elsewhere in the app.
    function removeBookmark(id) {
        authFetch(API_BASE + '/bookmarks/' + id, { method: 'POST' })
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    if (window.SharefWallet) window.SharefWallet.showToast(data.message || 'Could not remove bookmark.');
                    return;
                }
                savedBookmarks = savedBookmarks.filter(item => item.id !== id);
                renderBookmarks();
            })
            .catch((err) => {
                console.error('Could not remove bookmark:', err);
                if (window.SharefWallet) window.SharefWallet.showToast('Network error — could not remove bookmark.');
            });
    }
});
