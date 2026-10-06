import { countPages } from "../utils/pageCounter.js";
import { uploadToCloudinary } from "../utils/cloudinaryUpload.js";
import { uploadResourceSchema, formatZodErrors } from "../validators/resourceValidators.js";
import { generateId } from "../utils/id.js";
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

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".pptx", ".zip", ".jpg", ".jpeg", ".png"];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB — see uploadMiddleware.js's original comment: kept
// comfortably under Cloudinary's free-tier ~10MB per-file cap.

function extname(fileName) {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i).toLowerCase();
}

// @route POST /api/resources/upload
export async function uploadResource(c) {
  let body;
  try {
    body = await c.req.parseBody();
  } catch (err) {
    return c.json({ success: false, message: "Could not read the upload" }, 400);
  }

  const file = body.file;
  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return c.json({ success: false, message: "A file is required" }, 400);
  }

  const fileExtension = extname(file.name);
  if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
    return c.json(
      { success: false, message: "Unsupported file type. Allowed: PDF, DOCX, PPTX, ZIP, JPG, PNG" },
      400
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ success: false, message: "File too large. Max size is 8MB." }, 400);
  }

  const parsed = uploadResourceSchema.safeParse({
    title: body.title,
    type: body.type,
    department: body.department,
    course: body.course,
    level: body.level,
    semester: body.semester,
    session: body.session,
    description: body.description,
  });
  if (!parsed.success) {
    return c.json({ success: false, errors: formatZodErrors(parsed.error) }, 400);
  }
  const { title, type, department, course, level, semester, session, description } = parsed.data;

  const user = c.get("user");

  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const pages = await countPages(fileBuffer, file.name);

    // Preview snippet generation is deliberately deferred — see
    // browseController.js's getResourcePreview, which computes and caches
    // it on the FIRST actual preview request instead of here. Parsing a
    // PDF for text (unpdf) is real CPU work, and doing it for every single
    // upload — including the ones nobody ever previews — is wasted cost.
    // This mirrors how the admin full-text preview already worked in the
    // original app: fetched and parsed from Cloudinary on demand, never
    // eagerly at upload time.

    // The stored file always uploads as "raw", regardless of type. PDFs
    // used to briefly use "image" here to unlock a page-crop
    // transformation, but Cloudinary blocks serving the UNTRANSFORMED
    // original through the "image" resource type by default — that broke
    // both downloads and the admin full-document preview, which both need
    // the real, unmodified file. "raw" has no such restriction.
    const cloudinaryResult = await uploadToCloudinary(c.env, file, { folder: "sharef_resources" });

    const id = generateId();
    const timestamp = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO resources
        (id, title, type, department, course, level, semester, session, description, uploader_id,
         file_name, file_url, cloudinary_public_id, cloudinary_resource_type, file_size_bytes, file_extension,
         pages, preview_type, preview_snippet, preview_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id, title, type, department, course, level, semester, session, description || "", user.id,
        file.name, cloudinaryResult.secure_url, cloudinaryResult.public_id, file.size, fileExtension,
        pages, "pending", "", "",
        timestamp, timestamp
      )
      .run();

    // recipient NULL = shared admin feed, same as the original's
    // Notification.create({ resource, recipient: null, type: "new_upload" })
    await c.env.DB.prepare(
      "INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES (?, ?, NULL, 'new_upload', 1, ?, ?)"
    )
      .bind(generateId(), id, timestamp, timestamp)
      .run();

    return c.json(
      {
        success: true,
        message: "Resource submitted for review. You'll be notified once it's approved.",
        resource: {
          id, title, type, course, pages, description: description || "",
          size: formatFileSize(file.size), status: "pending",
        },
      },
      201
    );
  } catch (err) {
    if (err.isPageCountError) {
      return c.json({ success: false, message: err.message }, 422);
    }
    console.error(`Upload failed for "${file?.name}" (${file?.size} bytes):`, err.stack || err.message);

    // Cloudinary enforces its own account-level maximum file size,
    // independent of and possibly smaller than this app's own 8MB cap
    // above. Its error for that is always exactly this shape: "File size
    // too large. Got <bytes>. Maximum is <bytes>." — recognizable and safe
    // to surface directly, since it's actionable operational info, not a
    // security-sensitive detail.
    if (typeof err.message === "string" && /File size too large\. Got \d+\. Maximum is \d+\./.test(err.message)) {
      return c.json(
        {
          success: false,
          message: "This file is too large for our current storage plan. Please try a smaller file or contact the site admin.",
        },
        413
      );
    }

    return c.json({ success: false, message: "Upload failed", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/resources
// Public browse/search of approved resources with optional filters + pagination
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

// Upload (POST /api/resources/upload) lands in phase 4c — Cloudinary REST
// swap + pdf-parse->unpdf swap are their own scoped piece of work.

export { formatResource, formatFileSize };
