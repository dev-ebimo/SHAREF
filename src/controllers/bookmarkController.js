import { sanitizeError } from "../utils/sanitizeError.js";
import { generateId } from "../utils/id.js";
import { shapeResource } from "../utils/resourceShape.js";

function nowIso() {
  return new Date().toISOString();
}

// @route POST /api/bookmarks/:resourceId
// Toggles a bookmark on/off — one endpoint handles both add and remove
export async function toggleBookmark(c) {
  try {
    const resourceId = c.req.param("resourceId");
    const user = c.get("user");

    const resource = await c.env.DB.prepare("SELECT id, status FROM resources WHERE id = ?").bind(resourceId).first();
    if (!resource || resource.status !== "approved") {
      return c.json({ success: false, message: "Resource not available" }, 404);
    }

    const existing = await c.env.DB.prepare("SELECT id FROM bookmarks WHERE user_id = ? AND resource_id = ?")
      .bind(user.id, resourceId)
      .first();

    if (existing) {
      await c.env.DB.prepare("DELETE FROM bookmarks WHERE id = ?").bind(existing.id).run();
      return c.json({ success: true, bookmarked: false, message: "Removed from bookmarks" });
    }

    const timestamp = nowIso();
    await c.env.DB.prepare(
      "INSERT INTO bookmarks (id, user_id, resource_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(generateId(), user.id, resourceId, timestamp, timestamp)
      .run();

    return c.json({ success: true, bookmarked: true, message: "Saved to bookmarks" });
  } catch (err) {
    console.error("bookmarkController error:", err?.message);
    return c.json({ success: false, message: "Could not update bookmark", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/bookmarks
export async function getBookmarks(c) {
  try {
    const user = c.get("user");

    const { results } = await c.env.DB.prepare(
      `SELECT r.* FROM bookmarks b
       JOIN resources r ON r.id = b.resource_id
       WHERE b.user_id = ? AND r.status = 'approved'
       ORDER BY b.created_at DESC`
    )
      .bind(user.id)
      .all();

    return c.json({ success: true, resources: results.map(shapeResource) });
  } catch (err) {
    console.error("bookmarkController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch bookmarks", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/bookmarks/check/:resourceId
// Lets the frontend know whether to render a resource as already-bookmarked
export async function checkBookmark(c) {
  try {
    const resourceId = c.req.param("resourceId");
    const user = c.get("user");

    const existing = await c.env.DB.prepare("SELECT id FROM bookmarks WHERE user_id = ? AND resource_id = ?")
      .bind(user.id, resourceId)
      .first();

    return c.json({ success: true, bookmarked: !!existing });
  } catch (err) {
    console.error("bookmarkController error:", err?.message);
    return c.json({ success: false, message: "Could not check bookmark", error: sanitizeError(c.env, err) }, 500);
  }
}
