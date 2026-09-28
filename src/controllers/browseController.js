import { shapeResource } from "../utils/resourceShape.js";
import { buildPdfHalfPagePreviewUrl } from "../utils/cloudinaryPreview.js";
import getPreviewSnippet from "../utils/previewSnippet.js";

// @route GET /api/resources/recent
// Powers the "Recently Added" feed on the dashboard — only resources
// uploaded in the last 7 days. If nothing was added that recently, the
// frontend shows an empty state rather than falling back to older items,
// so "Recently Added" doesn't quietly become "Added at some point".
export async function getRecentFeed(c) {
  try {
    const limit = Number(c.req.query("limit")) || 10;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM resources WHERE status = 'approved' AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`
    )
      .bind(sevenDaysAgo, limit)
      .all();

    return c.json({ success: true, resources: results.map(shapeResource) });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch recent resources", error: err.message }, 500);
  }
}

// @route GET /api/resources/trending
// Powers the Trending resource cards — most downloaded in the last 3 days,
// scoped to the logged-in student's own department. A student with no
// department set yet (profile incomplete) has no "specific department" to
// scope to, so they just see an empty list — the frontend hides the
// section entirely rather than showing trending data from departments
// that aren't theirs.
export async function getTrending(c) {
  try {
    const limit = Number(c.req.query("limit")) || 6;
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const user = c.get("user");

    const requester = await c.env.DB.prepare("SELECT department FROM users WHERE id = ?").bind(user.id).first();
    const department = requester?.department;

    if (!department) {
      return c.json({ success: true, resources: [] });
    }

    // One query replaces the original's distinct-ids -> aggregate -> find
    // -> reorder-in-JS chain: scope to this department's approved
    // resources, count their downloads in the window, and rank — all in
    // SQL, in the department-scoped-first order the comment above requires.
    const { results } = await c.env.DB.prepare(
      `SELECT r.*, dl.recent_downloads AS recentDownloads
       FROM resources r
       JOIN (
         SELECT resource_id, COUNT(*) AS recent_downloads
         FROM download_logs
         WHERE created_at >= ?
           AND resource_id IN (SELECT id FROM resources WHERE status = 'approved' AND department = ?)
         GROUP BY resource_id
       ) dl ON dl.resource_id = r.id
       WHERE r.status = 'approved'
       ORDER BY dl.recent_downloads DESC
       LIMIT ?`
    )
      .bind(threeDaysAgo, department, limit)
      .all();

    const resources = results.map((r) => ({ ...shapeResource(r), recentDownloads: r.recentDownloads }));
    return c.json({ success: true, resources });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch trending resources", error: err.message }, 500);
  }
}

// @route GET /api/resources/continue-learning
// Most recently downloaded resources for the logged-in user.
export async function getContinueLearning(c) {
  try {
    const limit = Number(c.req.query("limit")) || 5;
    const user = c.get("user");

    // GROUP BY handles the "one row per resource, most recent download"
    // dedup natively, and LIMIT means only `limit` rows are ever fetched —
    // the original fetched the user's ENTIRE download history and deduped
    // in JS, flagged in the earlier performance audit as a query that
    // would only get slower as one user's history grows. This version
    // doesn't have that problem.
    const { results } = await c.env.DB.prepare(
      `SELECT r.*, MAX(dl.created_at) AS last_downloaded_at
       FROM download_logs dl
       JOIN resources r ON r.id = dl.resource_id
       WHERE dl.user_id = ? AND r.status = 'approved'
       GROUP BY r.id
       ORDER BY last_downloaded_at DESC
       LIMIT ?`
    )
      .bind(user.id, limit)
      .all();

    return c.json({ success: true, resources: results.map(shapeResource) });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch continue learning", error: err.message }, 500);
  }
}

// @route GET /api/resources/past-questions
// Search + filter for the Past Questions page
export async function searchPastQuestions(c) {
  try {
    const search = c.req.query("search") || "";
    const session = c.req.query("session") || "all";
    const semester = c.req.query("semester") || "all";
    const level = c.req.query("level") || "all";
    const sort = c.req.query("sort") || "newest";

    const conditions = ["status = 'approved'", "type = 'Past Question'"];
    const params = [];

    if (search) {
      conditions.push("(course LIKE ? OR title LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (session !== "all") {
      conditions.push("session = ?");
      params.push(session);
    }
    if (semester !== "all") {
      conditions.push("semester = ?");
      params.push(semester);
    }
    if (level !== "all") {
      conditions.push("level = ?");
      params.push(level);
    }

    let orderBy = "created_at DESC"; // newest first (default)
    if (sort === "oldest") orderBy = "created_at ASC";
    if (sort === "downloads") orderBy = "downloads DESC";

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM resources WHERE ${conditions.join(" AND ")} ORDER BY ${orderBy}`
    )
      .bind(...params)
      .all();

    return c.json({ success: true, resources: results.map(shapeResource) });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch past questions", error: err.message }, 500);
  }
}

// @route GET /api/resources/:id/preview
// Student-facing preview — only ever shows a fraction of page 1, never the
// full document. DOCX/PPTX get the pre-extracted half-page text snippet.
// New PDF uploads no longer get a preview image generated at all (they're
// treated the same as ZIP — previewType "none") — the "image" branch below
// only still fires for PDFs that were uploaded before that change and
// already have a previewImagePublicId stored.
// Computes the preview snippet on the FIRST request for a resource whose
// preview is still "pending" (deferred from upload — see the comment in
// resourceController.js's uploadResource for why), then caches the result
// in D1 so every subsequent view is a plain column read, not a re-parse.
//
// A harmless race is possible if two students open the same brand-new
// resource's preview at almost the same moment — both would compute and
// UPDATE independently. Same end result either way (idempotent), and not
// worth adding locking for at this scale.
async function computeAndCachePreview(c, resource) {
  const upstream = await fetch(resource.file_url);
  if (!upstream.ok) {
    throw new Error(`Could not fetch file from storage (status ${upstream.status})`);
  }
  const fileBuffer = Buffer.from(await upstream.arrayBuffer());
  const result = await getPreviewSnippet(fileBuffer, resource.file_name);

  const previewType = result.available ? "text" : "none";
  const previewSnippet = previewType === "text" ? result.snippet : "";
  const previewMessage = previewType === "none" ? result.message || "Preview not available for this file type." : "";

  await c.env.DB.prepare(
    "UPDATE resources SET preview_type = ?, preview_snippet = ?, preview_message = ?, updated_at = ? WHERE id = ?"
  )
    .bind(previewType, previewSnippet, previewMessage, new Date().toISOString(), resource.id)
    .run();

  if (previewType === "text") {
    return c.json({ success: true, previewType: "text", snippet: previewSnippet });
  }
  return c.json({ success: true, previewType: "none", message: previewMessage });
}

export async function getResourcePreview(c) {
  try {
    const id = c.req.param("id");
    const resource = await c.env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
    if (!resource || resource.status !== "approved") {
      return c.json({ success: false, message: "Resource not available" }, 404);
    }

    if (resource.preview_type === "pending") {
      return await computeAndCachePreview(c, resource);
    }

    if (resource.preview_type === "image") {
      return c.json({
        success: true,
        previewType: "image",
        imageUrl: buildPdfHalfPagePreviewUrl(c.env, resource.preview_image_public_id),
      });
    }

    if (resource.preview_type === "text") {
      return c.json({ success: true, previewType: "text", snippet: resource.preview_snippet });
    }

    return c.json({
      success: true,
      previewType: "none",
      message: resource.preview_message || "Preview not available for this file type.",
    });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch preview", error: err.message }, 500);
  }
}
