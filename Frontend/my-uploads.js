document.addEventListener('DOMContentLoaded', () => {
    
    // --- Mock Database Response ---
    // When your backend is ready, this array will be populated via a fetch() call to your API.
    const mockUploads = [
        {
            id: 1,
            title: "Intro to Data Structures",
            course: "CSC 201",
            type: "Lecture Notes",
            date: "Oct 12, 2025",
            status: "approved"
        },
        {
            id: 2,
            title: "Calculus II Past Questions",
            course: "MTH 202",
            type: "Past Questions",
            date: "Oct 15, 2025",
            status: "approved"
        },
        {
            id: 3,
            title: "Java OOP Assignment Solution",
            course: "CSC 203",
            type: "Assignments",
            date: "Oct 18, 2025",
            status: "pending"
        },
        {
            id: 4,
            title: "Physics Lab Manual 2",
            course: "PHY 102",
            type: "Lab Manual",
            date: "Oct 01, 2025",
            status: "rejected",
            rejectReason: "Blurry scan. Please re-upload with clear pages."
        }
    ];

    const uploadsGrid = document.getElementById('uploadsGrid');
    const emptyState = document.getElementById('emptyState');
    const tabButtons = document.querySelectorAll('.tab-btn');

    // --- Initial Render ---
    renderUploads('all');

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
        const filteredData = mockUploads.filter(item => {
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
            if (item.status === 'rejected' && item.rejectReason) {
                cardHTML += `<div class="rejection-reason"><strong>Note:</strong> ${item.rejectReason}</div>`;
            }

            cardHTML += `
                <div class="card-footer">
                    <span class="card-meta">Uploaded: ${item.date}</span>
                    ${item.status === 'rejected' ? `<button class="btn-primary-sm" onclick="alert('Trigger re-upload flow for ID: ${item.id}')">Re-upload</button>` : ''}
                </div>
            `;

            card.innerHTML = cardHTML;
            uploadsGrid.appendChild(card);
        });
    }
});
