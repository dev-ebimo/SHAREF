import { sanitizeError } from "../utils/sanitizeError.js";
import { incentiveCascadeForResource } from "../services/referralService.js";
import { reverseRewardsForResource } from "../services/rewardReversal.js";
import { adminDisplayName } from "../services/incentiveConfig.js";
import { buildDownloadStreamUrl } from "../utils/downloadToken.js";
import { deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

const REJECTION_REASONS = [
  "duplicate", "wrong_course", "wrong_dept", "poor_quality",
  "incomplete", "corrupted", "unsupported", "not_academic", "spam", "other",
];

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function shapeAdminResource(c, r, extra = {}) {
  const user = c.get("user");
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    department: r.department,
    course: r.course,
    level: r.level,
    semester: r.semester,
    session: r.session,
    description: r.description,
    fileExtension: r.file_extension,
    fileUrl: await buildDownloadStreamUrl(c, r.id, user.id),
    size: formatFileSize(r.file_size_bytes),
    downloads: r.downloads,
    uploader: r.uploader_full_name || "Unknown",
    reviewedBy: r.reviewer_full_name || "—",
    date: r.reviewed_at ? formatDate(r.reviewed_at) : formatDate(r.created_at),
    uploadedDate: formatDate(r.created_at),
    ...extra,
  };
}

// @route GET /api/admin/resources/filter-options
// Populates department/course dropdowns dynamically instead of hardcoding
// them — new departments/courses show up automatically as they're uploaded.
export async function getFilterOptions(c) {
  try {
    const [{ results: deptRows }, { results: courseRows }] = await Promise.all([
      c.env.DB.prepare("SELECT DISTINCT department FROM resources WHERE status IN ('approved', 'rejected') ORDER BY department").all(),
      c.env.DB.prepare("SELECT DISTINCT course FROM resources WHERE status IN ('approved', 'rejected') ORDER BY course").all(),
    ]);

    return c.json({
      success: true,
      departments: deptRows.map((r) => r.department),
      courses: courseRows.map((r) => r.course),
      types: ["Lecture Note", "Past Question", "Assignment Material", "Textbook", "Revision Sheet", "Other"],
      rejectionReasons: REJECTION_REASONS,
    });
  } catch (err) {
    console.error("adminResourceController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch filter options", error: sanitizeError(c.env, err) }, 500);
  }
}

function dateRangeIso(dateStr) {
  const start = new Date(dateStr);
  const end = new Date(dateStr);
  end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

// @route GET /api/admin/resources/approved
export async function getApprovedResources(c) {
  try {
    const search = c.req.query("search") || "";
    const department = c.req.query("department") || "";
    const type = c.req.query("type") || "";
    const course = c.req.query("course") || "";
    const approvalDate = c.req.query("approvalDate") || "";
    const sort = c.req.query("sort") || "newest";
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const skip = (page - 1) * limit;

    const conditions = ["r.status = 'approved'"];
    const params = [];
    if (search) { conditions.push("(r.title LIKE ? OR r.course LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    if (department) { conditions.push("r.department = ?"); params.push(department); }
    if (type) { conditions.push("r.type = ?"); params.push(type); }
    if (course) { conditions.push("r.course = ?"); params.push(course); }
    if (approvalDate) {
      const [start, end] = dateRangeIso(approvalDate);
      conditions.push("r.reviewed_at >= ? AND r.reviewed_at < ?");
      params.push(start, end);
    }
    const where = conditions.join(" AND ");

    let orderBy = "r.reviewed_at DESC";
    if (sort === "oldest") orderBy = "r.reviewed_at ASC";
    if (sort === "downloads") orderBy = "r.downloads DESC";

    const [{ results }, countRow, totalApprovedRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT r.*, u.full_name AS uploader_full_name, rev.full_name AS reviewer_full_name
         FROM resources r
         LEFT JOIN users u ON u.id = r.uploader_id
         LEFT JOIN users rev ON rev.id = r.reviewed_by
         WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      )
        .bind(...params, limit, skip)
        .all(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM resources r WHERE ${where}`).bind(...params).first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'approved'").first(),
    ]);

    const total = countRow.n;
    return c.json({
      success: true,
      resources: await Promise.all(results.map((r) => shapeAdminResource(c, r))),
      totalApproved: totalApprovedRow.n,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("adminResourceController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch approved resources", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/resources/rejected
export async function getRejectedResources(c) {
  try {
    const search = c.req.query("search") || "";
    const department = c.req.query("department") || "";
    const type = c.req.query("type") || "";
    const reason = c.req.query("reason") || "";
    const rejectionDate = c.req.query("rejectionDate") || "";
    const sort = c.req.query("sort") || "newest";
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const skip = (page - 1) * limit;

    const conditions = ["r.status = 'rejected'"];
    const params = [];
    if (search) { conditions.push("(r.title LIKE ? OR r.course LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }
    if (department) { conditions.push("r.department = ?"); params.push(department); }
    if (type) { conditions.push("r.type = ?"); params.push(type); }
    if (reason) { conditions.push("r.rejection_reason = ?"); params.push(reason); }
    if (rejectionDate) {
      const [start, end] = dateRangeIso(rejectionDate);
      conditions.push("r.reviewed_at >= ? AND r.reviewed_at < ?");
      params.push(start, end);
    }
    const where = conditions.join(" AND ");
    const orderBy = sort === "oldest" ? "r.reviewed_at ASC" : "r.reviewed_at DESC";

    const [{ results }, countRow, totalRejectedRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT r.*, u.full_name AS uploader_full_name, rev.full_name AS reviewer_full_name
         FROM resources r
         LEFT JOIN users u ON u.id = r.uploader_id
         LEFT JOIN users rev ON rev.id = r.reviewed_by
         WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      )
        .bind(...params, limit, skip)
        .all(),
      c.env.DB.prepare(`SELECT COUNT(*) AS n FROM resources r WHERE ${where}`).bind(...params).first(),
      c.env.DB.prepare("SELECT COUNT(*) AS n FROM resources WHERE status = 'rejected'").first(),
    ]);

    const total = countRow.n;
    return c.json({
      success: true,
      resources: await Promise.all(results.map((r) => shapeAdminResource(c, r, { rejectionReason: r.rejection_reason }))),
      totalRejected: totalRejectedRow.n,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("adminResourceController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch rejected resources", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/admin/resources/:id
// Powers both the Approved and Rejected details modals
export async function getResourceDetails(c) {
  try {
    const id = c.req.param("id");
    const resource = await c.env.DB.prepare(
      `SELECT r.*, u.full_name AS uploader_full_name, rev.full_name AS reviewer_full_name
       FROM resources r
       LEFT JOIN users u ON u.id = r.uploader_id
       LEFT JOIN users rev ON rev.id = r.reviewed_by
       WHERE r.id = ?`
    )
      .bind(id)
      .first();

    if (!resource) return c.json({ success: false, message: "Resource not found" }, 404);

    return c.json({ success: true, resource: await shapeAdminResource(c, resource, { rejectionReason: resource.rejection_reason }) });
  } catch (err) {
    console.error("adminResourceController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch resource", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/resources/:id/remove
// "Remove Resource" from the Approved page — functionally the same as a
// rejection, just triggered from a different screen. Guarded to only ever
// act on a resource that's currently approved — this endpoint's whole
// purpose is "take this OUT of Approved", so a resource that isn't there
// (already rejected, still pending) isn't a valid target for it, guard
// added here even though the original didn't have one.
export async function removeApprovedResource(c) {
  try {
    const id = c.req.param("id");
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const reason = body.reason;
    if (!reason) return c.json({ success: false, message: "A reason is required" }, 400);

    const result = await c.env.DB.prepare(
      "UPDATE resources SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'approved'"
    )
      .bind(reason, user.id, new Date().toISOString(), new Date().toISOString(), id)
      .run();

    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      const exists = await c.env.DB.prepare("SELECT id FROM resources WHERE id = ?").bind(id).first();
      return c.json({ success: false, message: exists ? "This resource is not currently approved" : "Resource not found" }, exists ? 409 : 404);
    }

    // Rewards paid for an approval that turned out to be a mistake are taken back automatically.
    // The removal itself has already succeeded, so a problem here is reported, not fatal.
    let message = "Resource removed and moved to Rejected";
    try {
      const ts = new Date().toISOString();
      const adminName = await adminDisplayName(c.env.DB, user.id);
      const undone = await reverseRewardsForResource(c.env.DB, { resourceId: id, adminId: user.id, adminName, reason: String(reason).slice(0, 300), ts });
      if (undone.count > 0) message += `. ${undone.count} reward(s) paid for it were taken back automatically.`;
    } catch (revErr) {
      console.error("auto-reversal failed:", revErr?.message);
      message += ". Its reward could not be reversed automatically, so please check Incentives → Payouts.";
    }
    return c.json({ success: true, message });
  } catch (err) {
    console.error("adminResourceController error:", err?.message);
    return c.json({ success: false, message: "Could not remove resource", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route POST /api/admin/resources/:id/restore
export async function restoreToPending(c) {
  try {
    const id = c.req.param("id");
    const result = await c.env.DB.prepare(
      "UPDATE resources SET status = 'pending', rejection_reason = '', reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ? AND status = 'rejected'"
    )
      .bind(new Date().toISOString(), id)
      .run();

    if ((result.meta?.changes ?? result.meta?.rows_written ?? 0) === 0) {
      const exists = await c.env.DB.prepare("SELECT id FROM resources WHERE id = ?").bind(id).first();
      return c.json({ success: false, message: exists ? "This resource is not currently rejected" : "Resource not found" }, exists ? 409 : 404);
    }

    return c.json({ success: true, message: "Resource restored to Pending" });
  } catch (err) {
    console.error("adminResourceController error:", err?.message);
    return c.json({ success: false, message: "Could not restore resource", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route DELETE /api/admin/resources/:id
// Cloudinary deletion happens first — if that fails, nothing in D1 has
// been touched yet, so the operation can simply be retried. The D1 side is
// a single atomic batch: bookmarks are deleted outright (meaningless once
// the resource is gone), download_logs are deleted too (their FK is
// NOT NULL, and this is usage/analytics data, not a financial record),
// while transactions and notifications have their resource_id nulled
// instead of being removed — a purchase's financial record and an
// uploader's notification history both have real value even after the
// underlying file is gone. studentNotificationController.js's
// getMyNotifications already filters out notifications whose resource_id
// no longer resolves, so a nulled notification just quietly stops
// appearing rather than crashing anything.
export async function permanentlyDeleteResource(c) {
  try {
    const id = c.req.param("id");
    const resource = await c.env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
    if (!resource) return c.json({ success: false, message: "Resource not found" }, 404);

    // Must match the resource_type the file was actually uploaded with —
    // destroying with the wrong type silently no-ops on Cloudinary and
    // leaves the file orphaned. Always "raw" for the main file (see
    // uploadController.js).
    await deleteFromCloudinary(c.env, resource.cloudinary_public_id);
    // PDFs also have a second, preview-only "image" asset — clean that up
    // too. Only ever set on legacy data from before the image-preview
    // pipeline was removed (see resourceController.js), so this is a no-op
    // for anything uploaded after that change.
    if (resource.preview_image_public_id) {
      // Cloudinary's destroy signature only takes public_id, so the
      // resource_type difference doesn't change the call shape here — it
      // was only relevant to the SDK's local routing, not the signed
      // request itself.
      await deleteFromCloudinary(c.env, resource.preview_image_public_id);
    }

    const timestamp = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM bookmarks WHERE resource_id = ?").bind(id),
      c.env.DB.prepare("DELETE FROM download_logs WHERE resource_id = ?").bind(id),
      c.env.DB.prepare("UPDATE transactions SET resource_id = NULL WHERE resource_id = ?").bind(id),
      c.env.DB.prepare("UPDATE notifications SET resource_id = NULL, updated_at = ? WHERE resource_id = ?").bind(timestamp, id),
      ...incentiveCascadeForResource(c.env.DB, id),
      c.env.DB.prepare("DELETE FROM resources WHERE id = ?").bind(id),
    ]);

    return c.json({ success: true, message: "Resource permanently deleted" });
  } catch (err) {
    console.error("adminResourceController error:", err?.message);
    return c.json({ success: false, message: "Could not delete resource", error: sanitizeError(c.env, err) }, 500);
  }
}
