// ==========================================================================
// ADMIN SHARED CHROME
//    Every admin page (moderation, notifications, settings, announcements,
//    users, approved/rejected resources) ships identical top-nav markup:
//    an avatar with "EB" initials, an account-menu dropdown showing
//    "Ebimotimi Shadrack", and a notification bell with a badge dot — but
//    until now nothing ever replaced those placeholders with the real,
//    logged-in admin's identity or a genuine unread count. Each page's own
//    script (admin-moderation.js, admin-settings.js, etc.) already handles
//    that page's own content; this file only handles the chrome that's
//    identical across all of them, so it doesn't need to be duplicated six
//    times over.
//
//    Deliberately its own file, not a shared dependency with the
//    student-facing dashboard.js: the two roles show entirely different
//    people (the logged-in admin vs. the logged-in student) and pull
//    notifications from different endpoints (/api/admin/notifications,
//    the moderation feed — vs. /api/notifications/mine, a student's own
//    personal notifications). Coupling them would mean either page
//    accidentally depending on logic that only makes sense for the other
//    role.
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
  var currentUser = requireAuth("admin");
  if (!currentUser) return;

  // Every admin page ships the same static "EB" placeholder in its avatar
  // markup — replace it with real initials derived from the logged-in
  // admin's name. Mirrors dashboard.js's updateAvatarInitials.
  (function updateAvatarInitials() {
    if (!currentUser.fullName) return;
    var parts = currentUser.fullName.trim().split(/\s+/);
    var initials = parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0])
      : parts[0].slice(0, 2);
    document.querySelectorAll(".avatar-initials").forEach(function (el) {
      el.textContent = initials.toUpperCase();
    });
  })();

  // Every admin page ships the same static "Ebimotimi Shadrack" placeholder
  // in its account-menu dropdown — replace it with the logged-in admin's
  // real name. Mirrors dashboard.js's updateNameAndGreeting (admin pages
  // have no time-of-day greeting to update, just this).
  (function updateAccountIdentity() {
    if (!currentUser.fullName) return;
    var fullName = currentUser.fullName.trim();
    document.querySelectorAll(".account-dropdown-identity h4").forEach(function (el) {
      el.textContent = fullName;
    });
    var trigger = document.getElementById("accountMenuTrigger");
    if (trigger) trigger.setAttribute("aria-label", "Account menu for " + fullName);
  })();

  // Every admin page ships its notification bell with a hardcoded,
  // always-visible red badge dot — replace it with the real unread state
  // from the moderation notification feed. Defaults to hidden (see
  // admin-moderation.css) and is only revealed once the actual count
  // confirms at least one unread item; a failed fetch just leaves it
  // hidden rather than risking a wrong badge.
  (function updateNotificationBadge() {
    var badgeEls = document.querySelectorAll(".badge-dot");
    var bellLink = document.querySelector(".icon-btn-badge");
    if (badgeEls.length === 0 && !bellLink) return;

    authFetch(API_BASE + "/admin/notifications")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) return;
        var unreadCount = data.notifications.filter(function (n) { return n.unread; }).length;

        badgeEls.forEach(function (el) {
          el.classList.toggle("is-visible", unreadCount > 0);
        });
        if (bellLink) {
          bellLink.setAttribute(
            "aria-label",
            unreadCount > 0 ? "Notifications, " + unreadCount + " unread" : "Notifications, no unread"
          );
        }
      })
      .catch(function (err) {
        console.error("Could not fetch notification status:", err);
      });
  })();
});
