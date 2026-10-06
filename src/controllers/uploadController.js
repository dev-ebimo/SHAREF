import { uploadResourceSchema, formatZodErrors } from "../validators/resourceValidators.js";
import { generateId } from "../utils/id.js";
import { sanitizeError } from "../utils/sanitizeError.js";
import { signUploadPermit, buildRawFileUrl, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";
import { inspectRemoteFile, matchesMagic } from "../utils/fileChecks.js";
import { purgeStaleUploads } from "../jobs/purgeStaleUploads.js";
import { formatFileSize } from "../utils/resourceShape.js";

// Direct-to-Cloudinary upload, in two cheap Worker calls:
//   1. POST /api/resources/upload/permit   -> validate metadata, hand back a signed permit
//   2. (browser uploads the file to Cloudinary itself — zero Worker CPU)
//   3. POST /api/resources/upload/complete -> verify the file, create the resource
//
// The file's bytes never enter the Worker, so none of this needs more than a
// millisecond or two of CPU.

const ALLOWED_EXTENSIONS = ["pdf", "docx", "pptx", "zip", "jpg", "jpeg", "png"];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // comfortably under Cloudinary's free ~10MB per-file cap
const PERMIT_TTL_MINUTES = 30;
const MAX_LIVE_PERMITS_PER_USER = 3;

function extOf(fileName) {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i + 1).toLowerCase();
}

// Display name only (the real storage key is server-generated): strip path
// separators and control characters, bound the length.
function cleanFileName(name) {
  return name.replace(/[\\/\u0000-\u001f\u007f]+/g, "_").trim().slice(0, 200);
}

// @route POST /api/resources/upload/permit
export async function requestUploadPermit(c) {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ success: false, message: "Invalid request" }, 400);
    }

    const { fileName, fileSize } = body;
    if (typeof fileName !== "string" || !fileName.trim()) {
      return c.json({ success: false, message: "A file is required" }, 400);
    }
    const ext = extOf(fileName);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return c.json({ success: false, message: "Unsupported file type. Allowed: PDF, DOCX, PPTX, ZIP, JPG, PNG" }, 400);
    }
    if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < 1) {
      return c.json({ success: false, message: "A file is required" }, 400);
    }
    if (fileSize > MAX_UPLOAD_BYTES) {
      return c.json({ success: false, message: "File too large. Max size is 8MB." }, 400);
    }

    const parsed = uploadResourceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, errors: formatZodErrors(parsed.error) }, 400);
    }

    const user = c.get("user");
    const now = new Date();
    const nowIso = now.toISOString();

    // Housekeeping for THIS user's abandoned permits (also frees their quota).
    c.executionCtx.waitUntil(purgeStaleUploads(c.env, { userId: user.id, limit: 3 }).catch(() => {}));

    // Bound how many unfinished uploads one account can have in flight, so a
    // permit can't be farmed to fill our Cloudinary storage with junk.
    const live = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM upload_intents WHERE user_id = ? AND expires_at >= ?")
      .bind(user.id, nowIso)
      .first();
    if (live.n >= MAX_LIVE_PERMITS_PER_USER) {
      return c.json(
        { success: false, message: "You already have uploads in progress. Please finish them or wait a few minutes, then try again." },
        429
      );
    }

    const id = generateId();
    // The public_id (storage path) is chosen here, never by the client. For raw
    // files the extension is part of it.
    const publicId = `sharef_resources/${id}.${ext}`;
    const expiresAt = new Date(now.getTime() + PERMIT_TTL_MINUTES * 60 * 1000).toISOString();

    await c.env.DB.prepare(
      `INSERT INTO upload_intents (id, user_id, public_id, file_name, file_extension, declared_size, metadata, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, user.id, publicId, cleanFileName(fileName), ext, fileSize, JSON.stringify(parsed.data), nowIso, expiresAt)
      .run();

    const permit = await signUploadPermit(c.env, publicId);
    return c.json({ success: true, intentId: id, upload: permit });
  } catch (err) {
    console.error("requestUploadPermit failed:", err?.message);
    return c.json({ success: false, message: "Could not start the upload", error: sanitizeError(c.env, err) }, 500);
  }
}

async function rejectIntent(c, intent) {
  // Remove the bad file and the intent. Cloudinary failure is non-fatal: the
  // intent row is deleted regardless (a leftover file is bounded to <=8MB/permit).
  await deleteFromCloudinary(c.env, intent.public_id, "raw").catch((e) =>
    console.error(`Could not delete rejected upload ${intent.public_id}:`, e?.message)
  );
  await c.env.DB.prepare("DELETE FROM upload_intents WHERE id = ?").bind(intent.id).run();
}

function submittedResponse(c, id, title, size, status = 201) {
  return c.json(
    {
      success: true,
      message: "Resource submitted for review. You'll be notified once it's approved.",
      resource: { id, title, size: formatFileSize(size), status: "pending" },
    },
    status
  );
}

// @route POST /api/resources/upload/complete
export async function completeUpload(c) {
  try {
    const body = await c.req.json().catch(() => null);
    const intentId = body?.intentId;
    if (typeof intentId !== "string" || !intentId) {
      return c.json({ success: false, message: "Invalid request" }, 400);
    }
    const user = c.get("user");

    const intent = await c.env.DB.prepare("SELECT * FROM upload_intents WHERE id = ? AND user_id = ?").bind(intentId, user.id).first();

    if (!intent) {
      // Already completed (double-click, retry after a network blip)? The
      // resource id equals the intent id, so just acknowledge it again.
      const existing = await c.env.DB.prepare("SELECT id, title, file_size_bytes FROM resources WHERE id = ? AND uploader_id = ?")
        .bind(intentId, user.id)
        .first();
      if (existing) return submittedResponse(c, existing.id, existing.title, existing.file_size_bytes, 200);
      return c.json({ success: false, message: "This upload session has expired. Please start the upload again." }, 410);
    }

    if (intent.expires_at < new Date().toISOString()) {
      c.executionCtx.waitUntil(rejectIntent(c, intent));
      return c.json({ success: false, message: "This upload session has expired. Please start the upload again." }, 410);
    }

    // One ranged request: total size + first bytes. No download.
    let info;
    try {
      info = await inspectRemoteFile(buildRawFileUrl(c.env, intent.public_id));
    } catch (err) {
      console.error(`completeUpload: file check failed for ${intent.public_id}:`, err?.message);
      // Keep the intent so the browser can retry if the upload hadn't landed yet.
      return c.json({ success: false, message: "We couldn't find your uploaded file. Please try again." }, 409);
    }

    if (info.size < 1 || info.size > MAX_UPLOAD_BYTES) {
      await rejectIntent(c, intent);
      return c.json({ success: false, message: "File too large. Max size is 8MB." }, 400);
    }
    if (!matchesMagic(intent.file_extension, info.head)) {
      await rejectIntent(c, intent);
      return c.json({ success: false, message: "That file doesn't look like a valid ." + intent.file_extension.toUpperCase() + " file." }, 400);
    }

    const meta = JSON.parse(intent.metadata);
    const timestamp = new Date().toISOString();

    try {
      // One atomic batch. The resource id is the intent id, so a concurrent
      // second completion hits the PRIMARY KEY and rolls back as a whole.
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO resources
            (id, title, type, department, course, level, semester, session, description, uploader_id,
             file_name, file_url, cloudinary_public_id, cloudinary_resource_type, file_size_bytes, file_extension,
             pages, preview_type, preview_snippet, preview_message, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?, ?, 1, 'pending', '', '', ?, ?)`
        ).bind(
          intent.id, meta.title, meta.type, meta.department, meta.course, meta.level, meta.semester, meta.session,
          meta.description || "", user.id, intent.file_name, buildRawFileUrl(c.env, intent.public_id), intent.public_id,
          info.size, intent.file_extension, timestamp, timestamp
        ),
        c.env.DB.prepare(
          "INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at) VALUES (?, ?, NULL, 'new_upload', 1, ?, ?)"
        ).bind(generateId(), intent.id, timestamp, timestamp),
        c.env.DB.prepare("DELETE FROM upload_intents WHERE id = ?").bind(intent.id),
      ]);
    } catch (err) {
      if (/UNIQUE constraint failed/i.test(String(err?.message))) {
        return submittedResponse(c, intent.id, meta.title, info.size, 200);
      }
      throw err;
    }

    return submittedResponse(c, intent.id, meta.title, info.size, 201);
  } catch (err) {
    console.error("completeUpload failed:", err?.message);
    return c.json({ success: false, message: "Could not finish the upload", error: sanitizeError(c.env, err) }, 500);
  }
}
