document.addEventListener('DOMContentLoaded', () => {

    // Real data — fetched from GET /api/notifications/mine. The backend
    // only ever produces three notification types for a student:
    // "resource_approved", "resource_rejected", and "announcement" — the
    // old mock "new_resource" / "account" types don't exist server-side.
    let notificationsData = [];

    function timeAgoLabel(isoDate) {
        const diffMs = Date.now() - new Date(isoDate).getTime();
        const mins = Math.floor(diffMs / 60000);
        const hours = Math.floor(diffMs / 3600000);
        const days = Math.floor(diffMs / 86400000);
        if (mins < 60) return mins <= 1 ? "Just now" : `${mins} minutes ago`;
        if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
        if (days === 1) return "Yesterday";
        return `${days} days ago`;
    }

    function dateGroupFor(isoDate) {
        const now = new Date();
        const d = new Date(isoDate);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        if (d >= startOfToday) return "Today";
        if (d >= startOfYesterday) return "Yesterday";
        return "Earlier";
    }

    function transformNotification(n) {
        const base = {
            id: n.id,
            type: n.type,
            isRead: !n.unread,
            createdAt: timeAgoLabel(n.createdAt),
            dateGroup: dateGroupFor(n.createdAt),
        };

        if (n.type === 'announcement') {
            return { ...base, title: n.title, message: n.message, actionText: null, actionUrl: null };
        }
        if (n.type === 'resource_approved') {
            return {
                ...base,
                title: "Resource Approved",
                message: `Your "${n.title}" has been approved.`,
                actionText: "View My Uploads →",
                actionUrl: "my-uploads.html",
            };
        }
        if (n.type === 'resource_rejected') {
            return {
                ...base,
                title: "Resource Rejected",
                message: n.rejectionReason
                    ? `Your upload "${n.title}" couldn't be approved. Reason: ${n.rejectionReason}.`
                    : `Your upload "${n.title}" couldn't be approved.`,
                actionText: "View Details →",
                actionUrl: "my-uploads.html",
            };
        }
        // Fallback for any future notification type this page doesn't know about yet
        return { ...base, title: n.title || "Notification", message: n.course ? `Related to ${n.course}.` : "", actionText: null, actionUrl: null };
    }

    async function fetchNotifications() {
        const res = await authFetch(`${API_BASE}/notifications/mine`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || "Could not load notifications");
        notificationsData = data.notifications.map(transformNotification);
    }

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
                        ${notif.actionText ? `<a href="${notif.actionUrl}" class="notif-action">${notif.actionText}</a>` : ''}
                    </div>
                    <div class="notif-time">${notif.createdAt}</div>
                `;

                // Mark as read on click
                card.addEventListener('click', (e) => {
                    if (!notif.isRead && !e.target.classList.contains('notif-action')) {
                        notif.isRead = true;
                        authFetch(`${API_BASE}/notifications/mine/${notif.id}/toggle-read`, { method: 'PATCH' }).catch(err => console.error(err));
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
        authFetch(`${API_BASE}/notifications/mine/mark-all-read`, { method: 'PATCH' }).catch(err => console.error(err));
    });

    // Initial Load
    fetchNotifications()
        .then(() => renderNotifications())
        .catch(err => {
            console.error(err);
            container.classList.add('hidden');
            emptyState.classList.remove('hidden');
        });
});
