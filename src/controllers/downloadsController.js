import { sanitizeError } from "../utils/sanitizeError.js";
import { buildDownloadStreamUrl } from "../utils/downloadToken.js";
import { formatFileSize, levelLabel } from "../utils/resourceShape.js";
import { recordDownloadOnly } from "./walletController.js";

// "Ownership" is the same record /wallet/charge uses to answer `alreadyOwned`:
// a successful purchase transaction. The unique index
// idx_transactions_one_purchase_per_resource guarantees at most one per
// (user, resource), so each resource appears once in the library.
//
// Purchases of a resource that was later deleted keep their transaction
// (resource_id is set NULL on deletion, see adminResourceController), so the
// student's spend history stays accurate. Those rows are listed with
// available:false, titled from the description the purchase stored.

// @route GET /api/downloads
export async function listMyDownloads(c) {
  try {
    const user = c.get("user");

    const { results } = await c.env.DB.prepare(
      `SELECT t.id AS tx_id, t.amount AS price_paid, t.description AS tx_description,
              r.id AS resource_id, r.title, r.course, r.type, r.level, r.status,
              r.file_extension, r.file_size_bytes,
              COALESCE(
                (SELECT MAX(dl.created_at) FROM download_logs dl
                  WHERE dl.user_id = t.user_id AND dl.resource_id = t.resource_id),
                t.created_at
              ) AS downloaded_at
         FROM transactions t
         LEFT JOIN resources r ON r.id = t.resource_id
        WHERE t.user_id = ? AND t.type = 'purchase' AND t.status = 'successful'
        ORDER BY downloaded_at DESC`
    )
      .bind(user.id)
      .all();

    const downloads = results.map((row) => {
      if (!row.resource_id) {
        // Resource was deleted after purchase.
        const [course, ...rest] = String(row.tx_description || "").split(" — ");
        return {
          id: row.tx_id,
          title: rest.length ? rest.join(" — ") : course || "Removed resource",
          course: rest.length ? course : "",
          type: "",
          level: "",
          fileExtension: "",
          size: "",
          pricePaid: row.price_paid,
          downloadedAt: row.downloaded_at,
          available: false,
        };
      }
      return {
        id: row.resource_id,
        title: row.title,
        course: row.course,
        type: row.type,
        level: levelLabel(row.level),
        fileExtension: row.file_extension,
        size: formatFileSize(row.file_size_bytes),
        pricePaid: row.price_paid,
        downloadedAt: row.downloaded_at,
        available: row.status === "approved",
      };
    });

    return c.json({ success: true, downloads });
  } catch (err) {
    console.error("downloadsController error:", err?.message);
    return c.json({ success: false, message: "Could not fetch your downloads", error: sanitizeError(c.env, err) }, 500);
  }
}

// @route GET /api/downloads/:resourceId/file
// Free re-download. MUST NEVER touch the wallet: it only checks ownership
// and mints a short-lived stream link. A caller who doesn't own the resource
// gets 403 whether or not the id exists, so this can't be used to probe ids.
export async function getDownloadFile(c) {
  try {
    const user = c.get("user");
    const resourceId = c.req.param("resourceId");

    const owned = await c.env.DB.prepare(
      "SELECT id FROM transactions WHERE user_id = ? AND resource_id = ? AND type = 'purchase' AND status = 'successful'"
    )
      .bind(user.id, resourceId)
      .first();
    if (!owned) {
      return c.json({ success: false, message: "You haven't downloaded this resource yet." }, 403);
    }

    const resource = await c.env.DB.prepare("SELECT id, status FROM resources WHERE id = ?").bind(resourceId).first();
    if (!resource || resource.status !== "approved") {
      return c.json({ success: false, message: "This resource is no longer available." }, 404);
    }

    // Same bookkeeping as the alreadyOwned branch of /wallet/charge, so the
    // library's "downloaded at" and the download counters behave identically
    // whichever endpoint the student used.
    await recordDownloadOnly(c, resourceId, user.id);

    return c.json({ success: true, fileUrl: await buildDownloadStreamUrl(c, resourceId, user.id) });
  } catch (err) {
    console.error("downloadsController error:", err?.message);
    return c.json({ success: false, message: "Could not start the download", error: sanitizeError(c.env, err) }, 500);
  }
}
