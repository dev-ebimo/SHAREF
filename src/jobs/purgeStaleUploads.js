import { deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

// Uploads go browser -> Cloudinary directly, so a user can start one and never
// finish it, leaving an orphan file in our Cloudinary account. Every permit has
// an expiry; this removes expired, never-completed intents together with
// their Cloudinary file.
//
//  - Called lazily (scoped to one user, tiny batch) whenever that user asks for
//    a new permit, so no extra infrastructure is needed.
//  - Called daily by the Cron Trigger (see scheduled() in index.js) to catch
//    users who never came back. Cron is optional: see SAVEPOINT-3.md.
//
// Each purged row costs one Cloudinary subrequest; the free plan allows 50 per
// invocation, so `limit` stays small.
export async function purgeStaleUploads(env, { userId = null, limit = 5 } = {}) {
  const now = new Date().toISOString();
  const query = userId
    ? env.DB.prepare("SELECT id, public_id FROM upload_intents WHERE user_id = ? AND expires_at < ? LIMIT ?").bind(userId, now, limit)
    : env.DB.prepare("SELECT id, public_id FROM upload_intents WHERE expires_at < ? LIMIT ?").bind(now, limit);
  const { results } = await query.all();

  let purged = 0;
  for (const intent of results || []) {
    try {
      await deleteFromCloudinary(env, intent.public_id, "raw");
      await env.DB.prepare("DELETE FROM upload_intents WHERE id = ?").bind(intent.id).run();
      purged++;
    } catch (err) {
      // Leave the row: it will be retried on the next run.
      console.error(`purgeStaleUploads: could not remove ${intent.public_id}:`, err?.message);
    }
  }
  return purged;
}
