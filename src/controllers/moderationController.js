import { sanitizeError } from "../utils/sanitizeError.js";
import { getFullText } from "../utils/previewSnippet.js";
import { buildDownloadStreamUrl } from "../utils/downloadToken.js";
import { startOfTodayInLagos } from "../utils/lagosDay.js";
import { timeAgo } from "../utils/timeAgo.js";
import { sendResourceStatusEmail } from "../services/emailService.js";
import { generateId } from "../utils/id.js";

const AGED_THRESHOLD_DAYS = 4;

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function nowIso() {
  return new Date().toISOString();
}

// @route GET /api/admin/moderation/queue
export async function getModerationQueue(c) {
  try {
    const sortDirection = c.req.query("sort") === "newest" ? "DESC" : "ASC";
    // 25 matches moderation.itemsPerPage's own schema default, so a
    // request with no explicit limit (or an admin who's never saved this
    // preference) still gets a sensible, genuinely paginated page size.
    const limit = Number(c.req.query("limit")) || 25;
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const skip = (page - 1) * limit;

    const { results } = await c.env.DB.prepare(
      `SELECT r.*, u.full_name AS uploader_full_name
       FROM resources r LEFT JOIN users u ON u.id = r.uploader_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ${sortDirection}
       LIMIT ? OFFSET ?`
    )
      .bind(limit, skip)
      .all();

    const queue = results.map((r) => {
      const ageDays = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
      return {
        id: r.id,
        title: r.title,
        type: r.type,
        dept: r.department,
        course: r.course,
        level: `${r.level} Level`,
        semester: r.semester,
        session: r.session,
        uploader: r.uploader_full_name,
        size: formatFileSize(r.file_size_bytes),
        uploadDate: timeAgo(r.created_at),
        isAged: ageDays >= AGED_THRESHOLD_DAYS,
        // Just enough to pick the right UI when Preview is clicked — the
        // actual content is fetched lazily via getResourcePreviewForAdmin.
        previewType: r.preview_type,
      };
    });

    const todayStartIso = startOfTodayInLagos().toISOString();
    const [pendingRow, approvedRow, rejectedRow, approvedTodayRow, rejectedTodayRow] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'pending'").first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'approved'").first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'rejected'").first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'approved' AND reviewed_at >= ?").bind(todayStartIso).first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'rejected' AND reviewed_at >= ?").bind(todayStartIso).first(),
    ]);

    const pending = pendingRow.n;
    return c.json({
      success: true,
      queue,
      stats: { pending, approved: approvedRow.n, rejected: rejectedRow.n, approvedToday: approvedTodayRow.n, rejectedToday: rejectedTodayRow.n },
      pagination: { total: pending, page, limit, pages: Math.max(1, Math.ceil(pending / limit)) },
    });
  } catch (err) {
    console.error("moderationController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch queue", error: sanitizeError(c.env, err) }, 500);
  }
}

// Shared by approveResource/rejectResource — notifies + emails the
// uploader per their own saved preferences, then clears the shared
// admin-feed "new_upload" notification for this resource now that it's
// been actioned.
async function notifyUploaderOfDecision(c, resource, type, reason) {
  const uploader = await c.env.DB.prepare("SELECT id, email, full_name, preferences FROM users WHERE id = ?")
    .bind(resource.uploader_id)
    .first();
  if (!uploader) return;

  const prefs = JSON.parse(uploader.preferences || "{}");
  const wantsInApp = prefs.notifications?.uploadStatus?.inApp ?? true;
  const wantsEmail = prefs.notifications?.uploadStatus?.email ?? true;

  if (wantsInApp) {
    const timestamp = nowIso();
    await c.env.DB.prepare(
      "INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)"
    )
      .bind(generateId(), resource.id, uploader.id, type, timestamp, timestamp)
      .run();
  }
  if (wantsEmail) {
    const status = type === "resource_approved" ? "approved" : "rejected";
    c.executionCtx.waitUntil(
      sendResourceStatusEmail(c.env, uploader.email, uploader.full_name, resource.title, status, reason).catch((err) => {
        console.error(`Failed to send status email to ${uploader.email}:`, err.message);
      })
    );
  }

  await c.env.DB.prepare("DELETE FROM notifications WHERE resource_id = ? AND recipient_id IS NULL")
    .bind(resource.id)
    .run();
}

// Inner logic, callable either from the route handler below (which reads
// the id from the URL) or from notificationController.js's quickApprove
// (which reads it off a notification's resource_id instead) — the two
// entry points share identical behavior, they just get the id from
// different places.
export async function approveResourceById(c, id) {
  const user = c.get("user");

  // Atomic, conditional — only actually approves a resource that's still
  // pending. The original had no such guard, so two admins (or one
  // double-click) approving the same item at once could fire the
  // uploader notification/email twice. This closes that.
  const result = await c.env.DB.prepare(
    "UPDATE resources SET status = 'approved', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
  )
    .bind(user.id, nowIso(), nowIso(), id)
    .run();

  if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
    const exists = await c.env.DB.prepare("SELECT id FROM resources WHERE id = ?").bind(id).first();
    return c.json({ success: false, message: exists ? "This resource has already been reviewed" : "Resource not found" }, exists ? 409 : 404);
  }

  const resource = await c.env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
  await notifyUploaderOfDecision(c, resource, "resource_approved");

  return c.json({ success: true, message: "Resource approved" });
}

// @route POST /api/admin/moderation/:id/approve
export async function approveResource(c) {
  try {
    return await approveResourceById(c, c.req.param("id"));
  } catch (err) {
    console.error("moderationController error:", err?.message);
    return c.json({ success: false, message: "Could not approve resource", error: sanitizeError(c.env, err) }, 500);
  }
}

export async function rejectResourceById(c, id, reason) {
  const user = c.get("user");

  const result = await c.env.DB.prepare(
    "UPDATE resources SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
  )
    .bind(reason, user.id, nowIso(), nowIso(), id)
    .run();

  if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
    const exists = await c.env.DB.prepare("SELECT id FROM resources WHERE id = ?").bind(id).first();
    return c.json({ success: false, message: exists ? "This resource has already been reviewed" : "Resource not found" }, exists ? 409 : 404);
  }

  const resource = await c.env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
  await notifyUploaderOfDecision(c, resource, "resource_rejected", reason);

  return c.json({ success: true, message: "Resource rejected" });
}

// @route POST /api/admin/moderation/:id/reject
// reason is optional — quick-review from the notifications panel skips it;
// the full moderation queue's reject modal always sends one (required client-side).
export async function rejectResource(c) {
  try {
    const body = await c.req.json().catch(() => ({}));
    return await rejectResourceById(c, c.req.param("id"), body.reason || "");
  } catch (err) {
    console.error("moderationController error:", err?.message);
    return c.json({ success: false, message: "Could not reject resource", error: sanitizeError(c.env, err) }, 500);
  }
}

export async function getResourcePreviewForAdminById(c, id) {
  const user = c.get("user");
  const resource = await c.env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
  if (!resource) return c.json({ success: false, message: "Resource not found" }, 404);

  const fileUrl = await buildDownloadStreamUrl(c, id, user.id);

  if (resource.preview_type === "text" || resource.preview_type === "pending") {
    try {
      const fileResponse = await fetch(resource.file_url);
      if (!fileResponse.ok) throw new Error(`Could not fetch file (status ${fileResponse.status})`);
      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
      const result = await getFullText(fileBuffer, resource.file_name);

      if (result.available) {
        return c.json({ success: true, previewType: "text", fullText: result.fullText, fileUrl });
      }
      return c.json({ success: true, previewType: "none", message: result.message || "Preview could not be generated for this document.", fileUrl });
    } catch (extractErr) {
      console.error(`Admin full-text preview failed for resource ${id}:`, extractErr.message);
      return c.json({ success: true, previewType: "none", message: "Preview could not be generated for this document.", fileUrl });
    }
  }

  // Legacy "image" PDFs (uploaded before the preview-image pipeline was
  // removed) and "none" both land here: no inline content, just the
  // download link so the admin can review the original file directly.
  return c.json({
    success: true,
    previewType: resource.preview_type === "image" ? "image" : "none",
    message: resource.preview_type === "image" ? "Download the file to review it in full." : (resource.preview_message || "Preview not available for this file type."),
    fileUrl,
  });
}

// @route GET /api/admin/moderation/:id/preview
// Admin review needs the ENTIRE document, unlike the student preview
// (which only ever shows a fraction of page 1) — extracted fresh on
// demand every time, never cached, since an admin only opens this once
// per item during review.
//
// previewType 'pending' is treated the same as 'text' here: it means "not
// yet known whether this extracts", which for a fresh upload an admin is
// reviewing for the first time is exactly the case worth attempting —
// this state didn't exist in the original app (see resourceController.js's
// uploadResource for why it was introduced), so admin preview needs to
// know about it too, not just the student-facing preview endpoint.
export async function getResourcePreviewForAdmin(c) {
  try {
    return await getResourcePreviewForAdminById(c, c.req.param("id"));
  } catch (err) {
    console.error("moderationController error:", err?.message);
    return c.json({ success: false, message: "Could not load preview", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/moderation/pending-count
// Powers the sidebar "Review Queue" badge and queue-health ring on every
// admin page — kept separate from getModerationQueue so pages that just
// need a number don't pay for fetching the whole queue.
export async function getPendingCount(c) {
  try {
    const fourDaysAgoIso = new Date(Date.now() - AGED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const [pendingRow, approvedRow, rejectedRow, agedRow] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'pending'").first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'approved'").first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'rejected'").first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'pending' AND created_at < ?").bind(fourDaysAgoIso).first(),
    ]);
    return c.json({ success: true, pending: pendingRow.n, approved: approvedRow.n, rejected: rejectedRow.n, agedCount: agedRow.n });
  } catch (err) {
    console.error("moderationController error:", err?.message);
    return c.json({ success: false, message: "Could not load pending count", error: sanitizeError(c.env, err) }, 500);
  }
}

export { formatFileSize };
