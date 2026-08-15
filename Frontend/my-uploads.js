document.addEventListener('DOMContentLoaded', () => {
    if (!currentUser) return; // dashboard.js already ran requireAuth() at the top of the file

    let uploads = [];

    const uploadsGrid = document.getElementById('uploadsGrid');
    const emptyState = document.getElementById('emptyState');
    const tabButtons = document.querySelectorAll('.tab-btn');

    function formatDate(isoString) {
        const d = new Date(isoString);
        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    }

    function loadUploads() {
        uploadsGrid.innerHTML = '<p class="uploads-loading">Loading your uploads…</p>';
        emptyState.classList.add('hidden');

        authFetch(API_BASE + '/resources/my-uploads')
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) {
                    uploadsGrid.innerHTML = '';
                    return;
                }
                uploads = data.resources;
                const activeTab = document.querySelector('.tab-btn.active');
                renderUploads(activeTab ? activeTab.getAttribute('data-filter') : 'all');
            })
            .catch((err) => {
                console.error('Could not load uploads:', err);
                uploadsGrid.innerHTML = '<p class="uploads-error">Could not load your uploads. Please refresh the page.</p>';
            });
    }

    // --- Initial Render ---
    loadUploads();

    // --- Tab Switching Logic ---
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Remove active class from all
            tabButtons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked
            e.target.classList.add('active');

            // Get filter value and render
            const filter = e.target.getAttribute('data-filter');
            renderUploads(filter);
        });
    });

    // --- Rendering Function ---
    function renderUploads(filter) {
        // Clear current grid
        uploadsGrid.innerHTML = '';

        // Filter the data
        const filteredData = uploads.filter(item => {
            if (filter === 'all') return true;
            return item.status === filter;
        });

        // Handle Empty State
        if (filteredData.length === 0) {
            uploadsGrid.classList.add('hidden');
            emptyState.classList.remove('hidden');
            return;
        }

        // Hide empty state, show grid
        uploadsGrid.classList.remove('hidden');
        emptyState.classList.add('hidden');

        // Build and append cards
        filteredData.forEach(item => {
            const card = document.createElement('div');
            card.className = 'resource-card';

            // Generate HTML string for the card
            let cardHTML = `
                <div class="card-header">
                    <div>
                        <h3 class="card-title">${item.title}</h3>
                        <span class="card-meta">${item.course} • ${item.type}</span>
                    </div>
                    <span class="status-badge status-${item.status}">${item.status}</span>
                </div>
            `;

            // If rejected, inject the reason
            if (item.status === 'rejected' && item.rejectionReason) {
                cardHTML += `<div class="rejection-reason"><strong>Note:</strong> ${item.rejectionReason}</div>`;
            }

            cardHTML += `
                <div class="card-footer">
                    <span class="card-meta">Uploaded: ${formatDate(item.createdAt)}</span>
                    ${item.status === 'rejected' ? `<a href="upload.html" class="btn-primary-sm">Re-upload</a>` : ''}
                </div>
            `;

            card.innerHTML = cardHTML;
            uploadsGrid.appendChild(card);
        });
    }
});
