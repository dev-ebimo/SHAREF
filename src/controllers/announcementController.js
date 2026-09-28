import { generateId } from "../utils/id.js";
import { sendAnnouncementEmail } from "../services/emailService.js";

function nowIso() {
  return new Date().toISOString();
}

// @route POST /api/admin/announcements
export async function createAnnouncement(c) {
  try {
    const body = await c.req.json();
    const { title, message, departments = [], levels = [] } = body;
    if (!title || !message) {
      return c.json({ success: false, message: "Title and message are required" }, 400);
    }

    const conditions = ["role = 'student'"];
    const params = [];
    if (departments.length > 0) {
      conditions.push(`department IN (${departments.map(() => "?").join(",")})`);
      params.push(...departments);
    }
    if (levels.length > 0) {
      conditions.push(`level IN (${levels.map(() => "?").join(",")})`);
      params.push(...levels);
    }

    // Only the fields the fan-out below actually uses — this can return
    // hundreds of rows, no reason to pull every column (password hash,
    // OTP fields, etc.) across the wire for it.
    const { results: recipients } = await c.env.DB.prepare(
      `SELECT id, email, full_name, preferences FROM users WHERE ${conditions.join(" AND ")}`
    )
      .bind(...params)
      .all();

    const id = generateId();
    const timestamp = nowIso();
    await c.env.DB.prepare(
      `INSERT INTO announcements (id, title, message, target_departments, target_levels, created_by, recipient_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, title, message, JSON.stringify(departments), JSON.stringify(levels), c.get("user").id, recipients.length, timestamp, timestamp)
      .run();

    // Fan out — each recipient's own preference decides in-app/email, same
    // split as the original.
    const inAppRecipients = [];
    const emailRecipients = [];
    for (const r of recipients) {
      const prefs = JSON.parse(r.preferences || "{}");
      if (prefs.notifications?.announcements?.inApp ?? true) inAppRecipients.push(r);
      if (prefs.notifications?.announcements?.email ?? true) emailRecipients.push(r);
    }

    // In-app notifications: one atomic batch() call per chunk instead of
    // one round trip per recipient — this is also what keeps a
    // few-hundred-recipient announcement well under Workers' free-tier
    // 50-subrequests-per-request cap (a single batch(), however many
    // statements it holds, counts as roughly one subrequest; N individual
    // .run() calls would each count separately and could blow the cap on
    // their own before a single email even goes out). Chunked at 200 per
    // batch as a defensive ceiling — Cloudflare's own guidance is
    // 100–500 statements per batch for reliable performance, not a hard
    // per-call limit.
    //
    // Trade-off worth naming: batch() is a real SQL transaction — a
    // single malformed row rolls back the WHOLE chunk, unlike the
    // original's insertMany(..., { ordered: false }), which tolerated one
    // bad document without dropping the rest. Accepted here because these
    // are simple, uniform, server-generated inserts (fresh UUID ids, no
    // per-row constraint that could plausibly fail) — the realistic
    // failure surface is very low, and the throughput/subrequest win is
    // large.
    const NOTIF_BATCH_SIZE = 200;
    for (let i = 0; i < inAppRecipients.length; i += NOTIF_BATCH_SIZE) {
      const chunk = inAppRecipients.slice(i, i + NOTIF_BATCH_SIZE);
      try {
        await c.env.DB.batch(
          chunk.map((r) =>
            c.env.DB.prepare(
              "INSERT INTO notifications (id, announcement_id, recipient_id, type, unread, created_at, updated_at) VALUES (?, ?, ?, 'announcement', 1, ?, ?)"
            ).bind(generateId(), id, r.id, timestamp, timestamp)
          )
        );
      } catch (notifyErr) {
        console.error("A batch of in-app announcement notifications failed:", notifyErr.message);
      }
    }

    // Emails: real known ceiling on the Workers FREE plan specifically —
    // each send is its own fetch() to SendGrid, hence its own subrequest,
    // and the free plan allows only 50 subrequests per request in total
    // (shared with the D1 queries above). An announcement emailing more
    // than roughly 50 people will hit that cap and fail partway through.
    // Not solved here deliberately — a proper fix (e.g. fanning out via a
    // Queue, so each email is its own invocation with its own budget) is
    // real infrastructure worth building once an announcement of that
    // size is an actual, not hypothetical, need.
    const EMAIL_BATCH_SIZE = 20;
    for (let i = 0; i < emailRecipients.length; i += EMAIL_BATCH_SIZE) {
      const batch = emailRecipients.slice(i, i + EMAIL_BATCH_SIZE);
      await Promise.all(
        batch.map((r) =>
          sendAnnouncementEmail(c.env, r.email, r.full_name, title, message).catch((emailErr) => {
            console.error(`Failed to email ${r.email}:`, emailErr.message);
          })
        )
      );
    }

    return c.json(
      { success: true, message: `Announcement sent to ${recipients.length} student(s)`, announcement: { id, title, message, recipientCount: recipients.length } },
      201
    );
  } catch (err) {
    return c.json({ success: false, message: "Could not send announcement", error: err.message }, 500);
  }
}

// @route GET /api/admin/announcements
export async function getAnnouncements(c) {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT a.*, u.full_name AS created_by_full_name
       FROM announcements a LEFT JOIN users u ON u.id = a.created_by
       ORDER BY a.created_at DESC`
    ).all();

    const announcements = results.map((a) => ({
      id: a.id,
      title: a.title,
      message: a.message,
      targetDepartments: JSON.parse(a.target_departments || "[]"),
      targetLevels: JSON.parse(a.target_levels || "[]"),
      createdBy: a.created_by_full_name,
      recipientCount: a.recipient_count,
      createdAt: a.created_at,
    }));

    return c.json({ success: true, announcements });
  } catch (err) {
    return c.json({ success: false, message: "Could not fetch announcements", error: err.message }, 500);
  }
}
