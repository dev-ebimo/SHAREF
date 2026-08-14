document.addEventListener('DOMContentLoaded', () => {

    let notificationsData = [
        { 
            id: "n_001", 
            type: "resource_approved", 
            title: "Resource Approved", 
            message: "Your \"CSC 201 Lecture Notes\" has been approved.", 
            isRead: false, 
            createdAt: "2 minutes ago", 
            dateGroup: "Today",
            actionText: "View Resource →",
            actionUrl: "#" 
        },
        { 
            id: "n_002", 
            type: "new_resource", 
            title: "New Lecture Notes", 
            message: "New CSC 202 lecture notes have been added to your department.", 
            isRead: false, 
            createdAt: "3 hours ago", 
            dateGroup: "Today",
            actionText: "Browse →",
            actionUrl: "#" 
        },
        { 
            id: "n_003", 
            type: "resource_rejected", 
            title: "Resource Rejected", 
            message: "Your upload \"MTH 101 Past Questions\" couldn't be approved. Reason: Duplicate Resource.", 
            isRead: true, 
            createdAt: "Yesterday", 
            dateGroup: "Yesterday",
            actionText: "View Details →",
            actionUrl: "#" 
        },
        { 
            id: "n_004", 
            type: "account", 
            title: "Password Updated", 
            message: "Your password was changed successfully.", 
            isRead: true, 
            createdAt: "2 days ago", 
            dateGroup: "Earlier",
            actionText: "Account Settings →",
            actionUrl: "#" 
        }
    ];

    const container = document.getElementById('notificationsContainer');
    const emptyState = document.getElementById('emptyState');
    const filterBtns = document.querySelectorAll('.qf-btn');
    const markAllBtn = document.getElementById('markAllRead');

    // SVG Icon Dictionary for clean UI
    const iconDictionary = {
        resource_approved: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
        resource_rejected: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
        new_resource: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`,
        account: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`,
        announcement: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`
    };

    function getIconClass(type) {
        if (type === 'resource_approved') return 'success';
        if (type === 'resource_rejected') return 'danger';
        return '';
    }

    function renderNotifications(filterType = 'all') {
        container.innerHTML = '';
        
        let filteredData = notificationsData;
        if (filterType === 'unread') {
            filteredData = notificationsData.filter(n => !n.isRead);
        }

        if (filteredData.length === 0) {
            container.classList.add('hidden');
            emptyState.classList.remove('hidden');
            return;
        }

        container.classList.remove('hidden');
        emptyState.classList.add('hidden');

        // Group by Date
        const grouped = filteredData.reduce((acc, notif) => {
            if (!acc[notif.dateGroup]) acc[notif.dateGroup] = [];
            acc[notif.dateGroup].push(notif);
            return acc;
        }, {});

        // Render Groups
        for (const [dateString, notifs] of Object.entries(grouped)) {
            const groupWrapper = document.createElement('div');
            groupWrapper.className = 'date-group';
            
            groupWrapper.innerHTML = `<h3 class="date-group-title">${dateString}</h3>`;
            
            notifs.forEach(notif => {
                const iconSvg = iconDictionary[notif.type] || iconDictionary['announcement'];
                const iconColorClass = getIconClass(notif.type);
                
                const card = document.createElement('div');
                card.className = `notification-card ${notif.isRead ? '' : 'unread'}`;
                
                card.innerHTML = `
                    <div class="notif-icon-wrapper ${iconColorClass}">
                        ${iconSvg}
                    </div>
                    <div class="notif-body">
                        <h4 class="notif-title">${notif.title}</h4>
                        <p class="notif-message">${notif.message}</p>
                        <a href="${notif.actionUrl}" class="notif-action">${notif.actionText}</a>
                    </div>
                    <div class="notif-time">${notif.createdAt}</div>
                `;

                // Mark as read on click
                card.addEventListener('click', (e) => {
                    if(!notif.isRead && !e.target.classList.contains('notif-action')) {
                        notif.isRead = true;
                        renderNotifications(document.querySelector('.qf-btn.active').dataset.filter);
                    }
                });

                groupWrapper.appendChild(card);
            });
            
            container.appendChild(groupWrapper);
        }
    }

    // Event Listeners
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderNotifications(e.target.dataset.filter);
        });
    });

    markAllBtn.addEventListener('click', () => {
        notificationsData = notificationsData.map(n => ({ ...n, isRead: true }));
        renderNotifications(document.querySelector('.qf-btn.active').dataset.filter);
    });

    // Initial Load
    renderNotifications();
});