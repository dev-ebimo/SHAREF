import { sanitizeError } from "../utils/sanitizeError.js";
function shape(n) {
  if (n.type === "announcement") {
    return {
      id: n.id,
      type: "announcement",
      title: n.a_title,
      message: n.a_message,
      unread: !!n.unread,
      createdAt: n.created_at,
    };
  }
  return {
    id: n.id,
    resourceId: n.resource_id,
    title: n.r_title,
    course: n.r_course,
    type: n.type,
    rejectionReason: n.type === "resource_rejected" ? n.r_rejection_reason : undefined,
    unread: !!n.unread,
    createdAt: n.created_at,
  };
}

// @route GET /api/notifications/mine
export async function getMyNotifications(c) {
  try {
    const user = c.get("user");

    // D1 has no populate() — LEFT JOIN both possible targets, then pick
    // whichever one is actually relevant for this row's type below.
    const { results } = await c.env.DB.prepare(
      `SELECT n.*,
              r.title AS r_title, r.course AS r_course, r.rejection_reason AS r_rejection_reason,
              a.title AS a_title, a.message AS a_message
       FROM notifications n
       LEFT JOIN resources r ON r.id = n.resource_id
       LEFT JOIN announcements a ON a.id = n.announcement_id
       WHERE n.recipient_id = ?
       ORDER BY n.created_at DESC`
    )
      .bind(user.id)
      .all();

    const notifications = results.filter((n) => n.r_title != null || n.a_title != null).map(shape);

    return c.json({ success: true, notifications });
  } catch (err) {
    console.error("studentNotificationController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch notifications", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route PATCH /api/notifications/mine/:id/toggle-read
export async function toggleMyNotificationRead(c) {
  try {
    const id = c.req.param("id");
    const user = c.get("user");

    const notification = await c.env.DB.prepare("SELECT id, unread FROM notifications WHERE id = ? AND recipient_id = ?")
      .bind(id, user.id)
      .first();
    if (!notification) return c.json({ success: false, message: "Notification not found" }, 404);

    const newUnread = notification.unread ? 0 : 1;
    await c.env.DB.prepare("UPDATE notifications SET unread = ?, updated_at = ? WHERE id = ?")
      .bind(newUnread, new Date().toISOString(), id)
      .run();

    return c.json({ success: true, unread: !!newUnread });
  } catch (err) {
    console.error("studentNotificationController error:", err?.message);
    return c.json({ success: false, message: "Could not update notification", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route PATCH /api/notifications/mine/mark-all-read
export async function markAllMyNotificationsRead(c) {
  try {
    const user = c.get("user");
    await c.env.DB.prepare("UPDATE notifications SET unread = 0, updated_at = ? WHERE recipient_id = ? AND unread = 1")
      .bind(new Date().toISOString(), user.id)
      .run();

    return c.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    console.error("studentNotificationController error:", err?.message);
    return c.json({ success: false, message: "Could not mark notifications as read", error: sanitizeError(c.env, err) }, 500);
  }
}
