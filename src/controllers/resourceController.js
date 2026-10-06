import { sanitizeError } from "../utils/sanitizeError.js";

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// r.uploader_full_name comes from the JOIN in each query below — D1 has no
// populate(), so the uploader's name is fetched via an explicit join
// instead of a separate lookup.
function formatResource(r) {
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
    fileName: r.file_name,
    fileExtension: r.file_extension,
    pages: r.pages,
    size: formatFileSize(r.file_size_bytes),
    downloads: r.downloads,
    status: r.status,
    uploader: r.uploader_full_name || undefined,
    createdAt: r.created_at,
  };
}

function getPagination(c) {
  const page = Math.max(1, parseInt(c.req.query("page")) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit")) || 12));
  return { page, limit, skip: (page - 1) * limit };
}

export async function getResources(c) {
  try {
    const department = c.req.query("department");
    const course = c.req.query("course");
    const level = c.req.query("level");
    const semester = c.req.query("semester");
    const type = c.req.query("type");
    const session = c.req.query("session");
    const search = c.req.query("search");
    const sort = c.req.query("sort");
    const { page, limit, skip } = getPagination(c);

    const conditions = ["r.status = 'approved'"];
    const params = [];
    if (department) { conditions.push("r.department = ?"); params.push(department); }
    if (course) { conditions.push("r.course = ?"); params.push(course); }
    if (level) { conditions.push("r.level = ?"); params.push(level); }
    if (semester) { conditions.push("r.semester = ?"); params.push(semester); }
    if (type) { conditions.push("r.type = ?"); params.push(type); }
    if (session) { conditions.push("r.session = ?"); params.push(session); }
    if (search) { conditions.push("r.title LIKE ?"); params.push(`%${search.trim()}%`); }

    const orderBy = sort === "popular" ? "r.downloads DESC" : "r.created_at DESC";
    const where = conditions.join(" AND ");

    const [{ results }, countRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT r.*, u.full_name AS uploader_full_name
         FROM resources r LEFT JOIN users u ON u.id = r.uploader_id
         WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      )
        .bind(...params, limit, skip)
        .all(),
      c.env.DB.prepare(`SELECT COUNT(*) AS total FROM resources r WHERE ${where}`)
        .bind(...params)
        .first(),
    ]);

    const total = countRow.total;
    return c.json({
      success: true,
      count: results.length,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      resources: results.map(formatResource),
    });
  } catch (err) {
    console.error("resourceController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch resources", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/resources/my-uploads
// Everything the logged-in user has uploaded, any status, optionally filtered by status
export async function getMyUploads(c) {
  try {
    const user = c.get("user");
    const status = c.req.query("status");
    const { page, limit, skip } = getPagination(c);

    const conditions = ["r.uploader_id = ?"];
    const params = [user.id];
    if (status) { conditions.push("r.status = ?"); params.push(status); }
    const where = conditions.join(" AND ");

    const [{ results }, countRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT r.*, u.full_name AS uploader_full_name
         FROM resources r LEFT JOIN users u ON u.id = r.uploader_id
         WHERE ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
      )
        .bind(...params, limit, skip)
        .all(),
      c.env.DB.prepare(`SELECT COUNT(*) AS total FROM resources r WHERE ${where}`)
        .bind(...params)
        .first(),
    ]);

    const total = countRow.total;
    return c.json({
      success: true,
      count: results.length,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      resources: results.map((r) => ({ ...formatResource(r), rejectionReason: r.rejection_reason })),
    });
  } catch (err) {
    console.error("resourceController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch your uploads", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/resources/:id
// Approved resources are visible to anyone; pending/rejected only to the uploader or an admin
export async function getResourceById(c) {
  try {
    const id = c.req.param("id");
    const user = c.get("user");

    const resource = await c.env.DB.prepare(
      `SELECT r.*, u.full_name AS uploader_full_name
       FROM resources r LEFT JOIN users u ON u.id = r.uploader_id
       WHERE r.id = ?`
    )
      .bind(id)
      .first();

    if (!resource) {
      return c.json({ success: false, message: "Resource not found" }, 404);
    }

    const isOwner = resource.uploader_id === user.id;
    const isAdmin = user.role === "admin";
    if (resource.status !== "approved" && !isOwner && !isAdmin) {
      return c.json({ success: false, message: "Resource not found" }, 404);
    }

    return c.json({ success: true, resource: formatResource(resource) });
  } catch (err) {
    console.error("resourceController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch resource", error: sanitizeError(c.env, err) }, 500);
  }
}

export { formatResource, formatFileSize };
