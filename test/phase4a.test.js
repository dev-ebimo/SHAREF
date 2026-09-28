import fs from "node:fs";
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";

const schemaSql = fs.readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8");

let passed = 0;
let failed = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log("OK  -", label);
    passed++;
  } else {
    console.log("FAIL-", label, extra);
    failed++;
  }
}

function freshEnv() {
  const DB = createMockD1(schemaSql);
  return {
    env: { DB, JWT_SECRET: "test-secret-do-not-use-in-prod", FRONTEND_URL: "https://sharef-test.vercel.app" },
    DB,
  };
}

async function tokenFor(env, id, role) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ id, role, iat: now, exp: now + 7 * 24 * 60 * 60 }, env.JWT_SECRET);
}

async function authed(path, token, opts = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
    }),
    opts._env
  );
}

function seedUser(DB, { id = "u1", role = "student" } = {}) {
  DB._raw
    .prepare(`INSERT INTO users (id, full_name, email, password, role, is_verified, preferences) VALUES (?, ?, ?, ?, ?, 1, '{}')`)
    .run(id, "Test User", `${id}@example.com`, "hash", role);
  return id;
}

function seedResource(DB, { id = "r1", uploader = "u1", status = "approved" } = {}) {
  DB._raw
    .prepare(
      `INSERT INTO resources
       (id, title, type, department, course, level, semester, session, uploader_id,
        file_name, file_url, cloudinary_public_id, file_size_bytes, file_extension, status)
       VALUES (?, 'Intro to Systems', 'Textbook', 'CS', 'CS301', '300', 'First', '2024/2025', ?,
               'file.pdf', 'https://res.cloudinary.com/demo/raw/upload/file.pdf', 'pub1', 204800, 'pdf', ?)`
    )
    .run(id, uploader, status);
  return id;
}

async function run() {
  // =========================================================================
  // protect middleware
  // =========================================================================
  {
    const { env } = freshEnv();
    const res = await app.fetch(new Request("http://localhost/api/bookmarks"), env);
    check("protect: no token -> 401", res.status === 401);
  }
  {
    const { env } = freshEnv();
    const res = await app.fetch(
      new Request("http://localhost/api/bookmarks", { headers: { Authorization: "Bearer garbage.not.a.jwt" } }),
      env
    );
    check("protect: malformed token -> 401", res.status === 401);
  }
  {
    const { env, DB } = freshEnv();
    const token = await tokenFor(env, "ghost-user", "student"); // never inserted into users table
    const res = await app.fetch(
      new Request("http://localhost/api/bookmarks", { headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    check("protect: valid token but deleted/nonexistent user -> 401", res.status === 401);
  }
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const token = await tokenFor(env, "u1", "student");
    const res = await app.fetch(
      new Request("http://localhost/api/bookmarks", { headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    check("protect: valid token + existing user -> passes through (200)", res.status === 200);
  }

  // =========================================================================
  // bookmarks
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1", status: "approved" });
    const token = await tokenFor(env, "u1", "student");

    // toggle on
    const res1 = await app.fetch(
      new Request("http://localhost/api/bookmarks/r1", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    const body1 = await res1.json();
    check("bookmarks: toggle on -> 200, bookmarked=true", res1.status === 200 && body1.bookmarked === true, JSON.stringify(body1));

    // check reflects it
    const res2 = await app.fetch(
      new Request("http://localhost/api/bookmarks/check/r1", { headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    const body2 = await res2.json();
    check("bookmarks: check -> bookmarked=true", body2.bookmarked === true);

    // list includes it, correctly shaped
    const res3 = await app.fetch(new Request("http://localhost/api/bookmarks", { headers: { Authorization: `Bearer ${token}` } }), env);
    const body3 = await res3.json();
    check("bookmarks: list contains the resource", body3.resources.length === 1 && body3.resources[0].id === "r1");
    check("bookmarks: shaped size field present", body3.resources[0].size === "200.0 KB");

    // toggle off
    const res4 = await app.fetch(
      new Request("http://localhost/api/bookmarks/r1", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    const body4 = await res4.json();
    check("bookmarks: toggle off -> bookmarked=false", body4.bookmarked === false);

    const res5 = await app.fetch(new Request("http://localhost/api/bookmarks", { headers: { Authorization: `Bearer ${token}` } }), env);
    const body5 = await res5.json();
    check("bookmarks: list empty after toggle off", body5.resources.length === 0);
  }
  {
    // bookmarking a non-approved (pending) resource is rejected
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r2", status: "pending" });
    const token = await tokenFor(env, "u1", "student");

    const res = await app.fetch(
      new Request("http://localhost/api/bookmarks/r2", { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    check("bookmarks: pending resource -> 404", res.status === 404);
  }
  {
    // one user's bookmark isn't visible to another user
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedUser(DB, { id: "u2" });
    seedResource(DB, { id: "r3", status: "approved" });
    const token1 = await tokenFor(env, "u1", "student");
    const token2 = await tokenFor(env, "u2", "student");

    await app.fetch(new Request("http://localhost/api/bookmarks/r3", { method: "POST", headers: { Authorization: `Bearer ${token1}` } }), env);

    const res = await app.fetch(new Request("http://localhost/api/bookmarks", { headers: { Authorization: `Bearer ${token2}` } }), env);
    const body = await res.json();
    check("bookmarks: isolated per user", body.resources.length === 0);
  }

  // =========================================================================
  // student notifications
  // =========================================================================
  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1" });
    const timestamp = new Date().toISOString();

    // a resource_approved notification
    DB._raw
      .prepare(
        `INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at)
         VALUES ('n1', 'r1', 'u1', 'resource_approved', 1, ?, ?)`
      )
      .run(timestamp, timestamp);

    // an announcement notification
    DB._raw
      .prepare(
        `INSERT INTO announcements (id, title, message, created_by) VALUES ('a1', 'Maintenance', 'Site down 2am-3am', 'u1')`
      )
      .run();
    DB._raw
      .prepare(
        `INSERT INTO notifications (id, announcement_id, recipient_id, type, unread, created_at, updated_at)
         VALUES ('n2', 'a1', 'u1', 'announcement', 1, ?, ?)`
      )
      .run(timestamp, timestamp);

    const token = await tokenFor(env, "u1", "student");
    const res = await app.fetch(new Request("http://localhost/api/notifications/mine", { headers: { Authorization: `Bearer ${token}` } }), env);
    const body = await res.json();
    check("notifications: 200 status", res.status === 200, JSON.stringify(body));
    check("notifications: both notifications returned", body.notifications.length === 2, JSON.stringify(body.notifications));

    const resourceNotif = body.notifications.find((n) => n.type === "resource_approved");
    check("notifications: resource notif shaped correctly", resourceNotif?.title === "Intro to Systems" && resourceNotif?.course === "CS301");

    const announcementNotif = body.notifications.find((n) => n.type === "announcement");
    check("notifications: announcement notif shaped correctly", announcementNotif?.title === "Maintenance" && announcementNotif?.message === "Site down 2am-3am");

    // toggle read on n1
    const toggleRes = await app.fetch(
      new Request("http://localhost/api/notifications/mine/n1/toggle-read", { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    const toggleBody = await toggleRes.json();
    check("notifications: toggle-read flips unread=false", toggleBody.unread === false, JSON.stringify(toggleBody));

    // mark all read
    const markAllRes = await app.fetch(
      new Request("http://localhost/api/notifications/mine/mark-all-read", { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }),
      env
    );
    check("notifications: mark-all-read -> 200", markAllRes.status === 200);

    const row2 = DB._raw.prepare("SELECT unread FROM notifications WHERE id = 'n2'").get();
    check("notifications: mark-all-read actually cleared n2", row2.unread === 0);
  }
  {
    // orphaned notification (resource was deleted) gets filtered out, not crashed on
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    const timestamp = new Date().toISOString();
    DB._raw
      .prepare(
        `INSERT INTO notifications (id, resource_id, recipient_id, type, unread, created_at, updated_at)
         VALUES ('n3', NULL, 'u1', 'resource_approved', 1, ?, ?)`
      )
      .run(timestamp, timestamp);

    const token = await tokenFor(env, "u1", "student");
    const res = await app.fetch(new Request("http://localhost/api/notifications/mine", { headers: { Authorization: `Bearer ${token}` } }), env);
    const body = await res.json();
    check("notifications: orphaned notif filtered out, no crash", res.status === 200 && body.notifications.length === 0, JSON.stringify(body));
  }

  // =========================================================================
  // download streaming
  // =========================================================================
  const realFetch = globalThis.fetch;
  function installStreamFetchMock() {
    globalThis.fetch = async (url, opts) => {
      if (typeof url === "string" && url.includes("res.cloudinary.com")) {
        return new Response("PRETEND PDF BYTES", {
          status: 200,
          headers: { "content-length": "17", "content-type": "application/octet-stream" },
        });
      }
      return realFetch(url, opts);
    };
  }
  function restoreFetch() {
    globalThis.fetch = realFetch;
  }

  {
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1" });
    installStreamFetchMock();

    // Build a real download token the same way the (future) chargeForDownload
    // flow will, via the util directly.
    const { signDownloadToken } = await import("../src/utils/downloadToken.js");
    const dlToken = await signDownloadToken(env, "r1", "u1");

    const res = await app.fetch(new Request(`http://localhost/api/resources/r1/stream?token=${dlToken}`), env);
    check("download: valid token -> 200", res.status === 200);
    check(
      "download: Content-Disposition has friendly filename",
      res.headers.get("content-disposition")?.includes("Intro_to_Systems.pdf"),
      res.headers.get("content-disposition")
    );
    check("download: Content-Type set from file extension", res.headers.get("content-type") === "application/pdf");
    const text = await res.text();
    check("download: body streamed through correctly", text === "PRETEND PDF BYTES");

    restoreFetch();
  }
  {
    // token issued for a DIFFERENT resource than the one requested
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1" });
    seedResource(DB, { id: "r2" });
    const { signDownloadToken } = await import("../src/utils/downloadToken.js");
    const dlToken = await signDownloadToken(env, "r1", "u1");

    const res = await app.fetch(new Request(`http://localhost/api/resources/r2/stream?token=${dlToken}`), env);
    check("download: mismatched resourceId -> 403", res.status === 403);
  }
  {
    // missing/garbage token
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1" });

    const res = await app.fetch(new Request("http://localhost/api/resources/r1/stream?token=not-a-real-token"), env);
    check("download: garbage token -> 401", res.status === 401);
  }
  {
    // a normal AUTH token (wrong purpose) used as a download token is rejected
    const { env, DB } = freshEnv();
    seedUser(DB, { id: "u1" });
    seedResource(DB, { id: "r1" });
    const authToken = await tokenFor(env, "u1", "student"); // purpose-less, normal auth shape

    const res = await app.fetch(new Request(`http://localhost/api/resources/r1/stream?token=${authToken}`), env);
    check("download: normal auth token rejected (wrong purpose) -> 401", res.status === 401);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("TEST RUNNER CRASHED:", e);
  process.exit(1);
});
