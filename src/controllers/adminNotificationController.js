import { timeAgo } from "../utils/timeAgo.js";
import { formatFileSize, approveResourceById, rejectResourceById, getResourcePreviewForAdminById } from "./moderationController.js";

// @route GET /api/admin/notifications
// The shared admin feed — recipient_id IS NULL. Two shapes coexist here:
// "new_upload" notifications (resource_id set) and "account_deleted"
// notifications (deleted_account_log_id set, created when a user deletes
// their own account — see userSettingsController.js's deleteMyAccount).
export async function getNotifications(c) {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT n.*,
              r.title AS r_title, r.type AS r_type, r.department AS r_dept, r.course AS r_course,
              r.level AS r_level, r.semester AS r_semester, r.session AS r_session, r.file_size_bytes AS r_file_size_bytes,
              u.full_name AS r_uploader_full_name,
              log.full_name AS log_full_name, log.email AS log_email, log.department AS log_department, log.level AS log_level,
              log.uploads_count AS log_uploads_count, log.total_deposited AS log_total_deposited, log.total_spent AS log_total_spent,
              log.created_at AS log_created_at
       FROM notifications n
       LEFT JOIN resources r ON r.id = n.resource_id
       LEFT JOIN users u ON u.id = r.uploader_id
       LEFT JOIN deleted_account_logs log ON log.id = n.deleted_account_log_id
       WHERE n.recipient_id IS NULL
       ORDER BY n.created_at DESC`
    ).all();

    const feed = results
      // Guard against the referenced resource/log having been removed
      // directly, for whichever kind this notification actually is.
      .filter((n) => (n.type === "account_deleted" ? n.log_full_name != null : n.r_title != null))
      .map((n) => {
        if (n.type === "account_deleted") {
          return {
            id: n.id,
            notifType: n.type,
            fullName: n.log_full_name,
            email: n.log_email,
            department: n.log_department,
            level: n.log_level,
            uploadsCount: n.log_uploads_count,
            totalDeposited: n.log_total_deposited,
            totalSpent: n.log_total_spent,
            deletedAt: timeAgo(n.log_created_at),
            timeAgo: timeAgo(n.created_at),
            unread: !!n.unread,
          };
        }

        // Unchanged from before — `type` here is the resource's own
        // category (e.g. "Past Question"), not the notification's kind.
        return {
          id: n.id,
          notifType: n.type,
          resourceId: n.resource_id,
          title: n.r_title,
          type: n.r_type,
          dept: n.r_dept,
          course: n.r_course,
          level: `${n.r_level} Level`,
          semester: n.r_semester,
          session: n.r_session,
          uploader: n.r_uploader_full_name,
          size: formatFileSize(n.r_file_size_bytes),
          timeAgo: timeAgo(n.created_at),
          unread: !!n.unread,
        };
      });

    return c.json({ success: true, notifications: feed });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch notifications", error: err.message }, 500);
  }
}

// @route PATCH /api/admin/notifications/:id/toggle-read
export async function toggleRead(c) {
  try {
    const id = c.req.param("id");
    const notification = await c.env.DB.prepare("SELECT unread FROM notifications WHERE id = ?").bind(id).first();
    if (!notification) return c.json({ success: false, message: "Notification not found" }, 404);

    const newUnread = notification.unread ? 0 : 1;
    await c.env.DB.prepare("UPDATE notifications SET unread = ?, updated_at = ? WHERE id = ?")
      .bind(newUnread, new Date().toISOString(), id)
      .run();

    return c.json({ success: true, unread: !!newUnread });
  } catch (err) {
    return c.json({ success: false, message: "Could not update notification", error: err.message }, 500);
  }
}

// @route PATCH /api/admin/notifications/mark-all-read
export async function markAllRead(c) {
  try {
    await c.env.DB.prepare("UPDATE notifications SET unread = 0, updated_at = ? WHERE recipient_id IS NULL AND unread = 1")
      .bind(new Date().toISOString())
      .run();
    return c.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    return c.json({ success: false, message: "Could not mark notifications as read", error: err.message }, 500);
  }
}

async function resolveNotificationResourceId(c, notificationId) {
  const notification = await c.env.DB.prepare("SELECT resource_id FROM notifications WHERE id = ?").bind(notificationId).first();
  if (!notification) return { error: c.json({ success: false, message: "Notification not found" }, 404) };
  if (!notification.resource_id) return { error: c.json({ success: false, message: "This notification has no associated resource" }, 400) };
  return { resourceId: notification.resource_id };
}

// @route GET /api/admin/notifications/:id/preview
// Quick-review preview — same full-document logic as the full moderation queue.
export async function quickPreview(c) {
  const { resourceId, error } = await resolveNotificationResourceId(c, c.req.param("id"));
  if (error) return error;
  try {
    return await getResourcePreviewForAdminById(c, resourceId);
  } catch (err) {
    return c.json({ success: false, message: "Could not load preview", error: err.message }, 500);
  }
}

// @route POST /api/admin/notifications/:id/approve
// Quick-review approve — same underlying logic as the full moderation queue.
export async function quickApprove(c) {
  const { resourceId, error } = await resolveNotificationResourceId(c, c.req.param("id"));
  if (error) return error;
  try {
    return await approveResourceById(c, resourceId);
  } catch (err) {
    return c.json({ success: false, message: "Could not approve resource", error: err.message }, 500);
  }
}

// @route POST /api/admin/notifications/:id/reject
export async function quickReject(c) {
  const { resourceId, error } = await resolveNotificationResourceId(c, c.req.param("id"));
  if (error) return error;
  try {
    const body = await c.req.json().catch(() => ({}));
    return await rejectResourceById(c, resourceId, body.reason || "");
  } catch (err) {
    return c.json({ success: false, message: "Could not reject resource", error: err.message }, 500);
  }
}
