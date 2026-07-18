document.addEventListener('DOMContentLoaded', () => {

    // Mock representation of bookmarked files from your schema logic
    let savedBookmarks = [
        { id: 101, title: "Data Structures & Algorithms Course Note", course: "CSC 201", type: "Lecture Notes" },
        { id: 102, title: "First Semester Calculus Exam Past Question 2024", course: "MTH 201", type: "Past Questions" },
        { id: 103, title: "Discrete Structures Logic Matrices Sheets", course: "CSC 205", type: "Lecture Notes" },
        { id: 104, title: "Database Systems Lab Manual Workbook", course: "CSC 208", type: "Assignments" }
    ];

    // Filled bookmark icon used in place of the pin emoji, matching the app-wide icon set
    const UNPIN_ICON_SVG = `<svg fill="currentColor" stroke="none" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L7 21V5z"/></svg>`;

    const bookmarksGrid = document.getElementById('bookmarksGrid');
    const emptyState = document.getElementById('emptyState');
    const searchInput = document.getElementById('bookmarkSearch');
    const typeFilter = document.getElementById('typeFilter');

    // Initial render call
    renderBookmarks();

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
                    <a href="#" class="btn-view" onclick="event.preventDefault(); alert('Opening resource payload placeholder...')">Open File &rarr;</a>
                    <button class="btn-unpin" title="Remove Bookmark" aria-label="Remove Bookmark">${UNPIN_ICON_SVG}</button>
                </div>
            `;

            // Attach inline removal click tracking
            card.querySelector('.btn-unpin').addEventListener('click', () => {
                removeBookmark(item.id);
            });

            bookmarksGrid.appendChild(card);
        });
    }

    // Handles interactive element updates without complete page reloads
    function removeBookmark(id) {
        savedBookmarks = savedBookmarks.filter(item => item.id !== id);
        renderBookmarks();
    }
});
