// Consistency pass: every fix from CHANGES-CONSISTENCY.md, exercised through the real routes / controllers against the
// real schema in SQLite.  Run: node --experimental-sqlite test/consistency.test.js
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { check, summary, freshEnv, ctx, one, all, n, iso, setCfg, seedUser, seedResource, seedBounty, LIVE_RULES } from "./incentiveTestLib.js";
import { requestUploadPermit, completeUpload, cancelUpload } from "../src/controllers/uploadController.js";
import { departmentKey } from "../src/utils/academic.js";

// ---- network stub: Cloudinary ranged check (a PDF header), SendGrid captured, everything else OK
let sentEmails = [];
globalThis.fetch = async (url, init = {}) => {
  if (typeof url === "string" && url.includes("api.sendgrid.com")) { sentEmails.push(JSON.parse(init.body)); return new Response(null, { status: 202 }); }
  if (init.headers && init.headers.Range) {
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), { status: 206, headers: { "content-range": "bytes 0-7/12345" } });
  }
  return new Response(JSON.stringify({ result: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
};

const tok = async (env, id, role = "student") => { const now = Math.floor(Date.now() / 1000); return sign({ id, role, iat: now, exp: now + 604800 }, env.JWT_SECRET); };
const call = async (env, method, path, { token, body, ctxObj } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const waits = [];
  const executionCtx = ctxObj || { waitUntil: (p) => waits.push(Promise.resolve(p).catch(() => {})), passThroughOnException() {} };
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, executionCtx);
  await Promise.all(waits);
  return res;
};
const world = () => {
  const w = freshEnv({ SENDGRID_API_KEY: "SG.x", SENDGRID_FROM_EMAIL: "n@s.test" });
  seedUser(w.DB, "admin1", { name: "Admin One", role: "admin", department: null, level: null });
  return w;
};
const approvedResource = (DB, id, o = {}) => {
  const department = o.department ?? "Computer Science";
  const course = o.course ?? "CSC 305";
  DB._raw.prepare(`INSERT INTO resources (id,title,type,department,department_key,course,course_key,level,semester,session,uploader_id,file_name,file_url,cloudinary_public_id,
      file_size_bytes,file_extension,pages,status,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'f.pdf','https://x/f.pdf','pub',1000,'pdf',5,?,?,?,?)`)
    .run(id, o.title ?? "T " + id, o.type ?? "Past Question", department, departmentKey(department), course, course.toUpperCase().replace(/[^A-Z0-9]/g, ""), o.level ?? "300", o.semester ?? "First",
      o.session ?? "2024/2025", o.uploader ?? "uploader", o.status ?? "approved", o.reviewedAt ?? iso(1), o.createdAt ?? iso(1), iso(1));
};

// =====================================================================================================
// 1. Wrong current password is a 400 (NOT 401, which the frontend treats as "session expired" -> logout)
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "stu");
  const { hashPassword } = await import("../src/utils/password.js");
  DB._raw.prepare("UPDATE users SET password = ? WHERE id = 'stu'").run(await hashPassword("correct-horse-1", env));
  const t = await tok(env, "stu");
  const res = await call(env, "PATCH", "/api/users/me/password", { token: t, body: { currentPassword: "wrong-password-1", newPassword: "brand-new-pass-1" } });
  check("password: wrong current password -> 400, not 401", res.status === 400);
  const stillIn = await call(env, "GET", "/api/users/me", { token: t });
  check("password: ...and the session is still valid afterwards", stillIn.status === 200);
}

// =====================================================================================================
// 2. Profile update uses the VALIDATED body: email normalised, matric upper-cased, department canonical
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "stu", { department: null, level: null });
  const t = await tok(env, "stu");
  const res = await call(env, "PATCH", "/api/users/me", {
    token: t,
    body: { fullName: "  Ada   Obi ", email: "Ada.Obi+school@GMAIL.com", department: "  computer   SCIENCE Dept. ", level: "300 Level", university: "UNIVERSITY OF PORT  HARCOURT", faculty: " science ", matricNumber: " u2019/ 5570 001 ", gender: "female" },
  });
  const row = one(DB, "SELECT * FROM users WHERE id = 'stu'");
  check("profile: saved (200)", res.status === 200, await res.clone().text());
  check("profile: email stored NORMALISED so login can find it", row.email === "adaobi@gmail.com", row.email);
  check("profile: matric number upper-cased, spaces removed", row.matric_number === "U2019/5570001", row.matric_number);
  check("profile: department stored canonical", row.department === "Computer Science", row.department);
  check("profile: department_key set explicitly (not left to a trigger)", row.department_key === "computer science", row.department_key);
  check("profile: name / university / faculty / level / gender tidied", row.full_name === "Ada Obi" && row.university === "University of Port Harcourt" && row.faculty === "Science" && row.level === "300" && row.gender === "Female", JSON.stringify(row));
  check("profile: changing to a different (normalised) email requires re-verification", row.is_verified === 0);

  // saving the same address in a different style is NOT a change, and doesn't force re-verification
  DB._raw.prepare("UPDATE users SET is_verified = 1 WHERE id = 'stu'").run();
  await call(env, "PATCH", "/api/users/me", { token: t, body: { email: "ADA.OBI@gmail.com" } });
  check("profile: same email in another style is not a change (no re-verification)", one(DB, "SELECT is_verified v FROM users WHERE id='stu'").v === 1);

  seedUser(DB, "other");
  DB._raw.prepare("UPDATE users SET matric_number = 'U2019/1' WHERE id = 'other'").run();
  const dup = await call(env, "PATCH", "/api/users/me", { token: t, body: { matricNumber: "u2019/1" } });
  check("profile: another student's matric number (different case) -> 409", dup.status === 409);
  const me = await (await call(env, "GET", "/api/users/me", { token: t })).json();
  check("profile: /users/me exposes departmentKey", me.user?.departmentKey === "computer science" || me.departmentKey === "computer science", JSON.stringify(me).slice(0, 300));
}

// =====================================================================================================
// 3. THE SCENARIO: a Computer Science student typed their department differently from the uploader
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  // Real upload flow with deliberately messy typing
  const up = { id: "uploader" };
  const permit = await requestUploadPermit(ctx(env, { user: up, body: { fileName: "csc305-2024.pdf", fileSize: 5000, title: "  CSC305   2024  past questions ", type: "past questions", department: "  computer   SCIENCE ", course: "csc305", level: "300 Level", semester: "1st", session: "2024-25" } }));
  check("scenario: messy-but-understandable upload metadata is accepted", permit.status === 200 && permit.body.success, JSON.stringify(permit.body));
  const done = await completeUpload(ctx(env, { user: up, body: { intentId: permit.body.intentId } }));
  const row = one(DB, "SELECT * FROM resources WHERE id = ?", permit.body.intentId);
  check("scenario: upload stored CANONICAL (title, type, department, course, level, semester, session)",
    done.status === 201 && row.title === "CSC305 2024 past questions" && row.type === "Past Question" && row.department === "Computer Science" && row.course === "CSC 305" && row.level === "300" && row.semester === "First" && row.session === "2024/2025", JSON.stringify(row));
  check("scenario: upload set department_key and course_key explicitly", row.department_key === "computer science" && row.course_key === "CSC305", `${row.department_key} / ${row.course_key}`);
  DB._raw.prepare("UPDATE resources SET status = 'approved', reviewed_at = ? WHERE id = ?").run(iso(0.5), row.id);

  // Three students who each typed "computer science" a different way
  seedUser(DB, "s1", { department: "Computer Science" });
  seedUser(DB, "s2", { department: "computer science" });
  seedUser(DB, "s3", { department: "Dept. of  Computer   Sciences " });
  seedUser(DB, "s4", { department: "CS" });
  seedUser(DB, "eng", { department: "Mechanical Engineering" });
  for (const id of ["s1", "s2", "s3", "s4", "eng"]) DB._raw.prepare("UPDATE users SET department_key = ? WHERE id = ?").run(departmentKey(one(DB, "SELECT department d FROM users WHERE id=?", id).d), id);
  for (const id of ["s1", "s2", "s3", "s4"]) {
    const r = await (await call(env, "GET", "/api/resources/recommended", { token: await tok(env, id) })).json();
    check(`scenario: "${one(DB, "SELECT department d FROM users WHERE id=?", id).d}" student sees the CS resource under "For you"`, r.resources?.length === 1 && r.resources[0].id === row.id, JSON.stringify(r));
  }
  const engRes = await (await call(env, "GET", "/api/resources/recommended", { token: await tok(env, "eng") })).json();
  check("scenario: a different department does NOT see it", engRes.resources.length === 0);

  // Filters, whatever the user typed
  const t = await tok(env, "s1");
  for (const q of ["department=computer%20science", "department=COMPUTER%20SCIENCE", "department=Department%20of%20Computer%20Science", "department=cs", "course=csc305", "course=CSC-305", "course=csc%20305", "level=300%20Level", "semester=1st", "session=2024-25", "type=past%20questions", "search=csc305", "search=CSC%20305", "search=past%20questions"]) {
    const r = await (await call(env, "GET", `/api/resources?${q}`, { token: t })).json();
    check(`filter: ?${q} finds it`, r.total === 1, JSON.stringify(r).slice(0, 200));
  }
  const wrong = await (await call(env, "GET", "/api/resources?course=MTH101", { token: t })).json();
  check("filter: a different course finds nothing", wrong.total === 0);
  const wild = await (await call(env, "GET", "/api/resources?search=%25", { token: t })).json();
  check("search: a lone '%' is a literal, not 'match everything'", wild.total === 0, String(wild.total));
  const pq = await (await call(env, "GET", "/api/resources/past-questions?search=csc305&level=300%20Level&semester=first&session=2024-25", { token: t })).json();
  check("past questions: search 'csc305' + normalised level/semester/session finds it", pq.resources?.length === 1, JSON.stringify(pq).slice(0, 200));

  // Trending is scoped by department key too
  DB._raw.prepare("INSERT INTO download_logs (id,user_id,resource_id,created_at,updated_at) VALUES ('d1','s2',?,?,?)").run(row.id, iso(0.1), iso(0.1));
  const trend = await (await call(env, "GET", "/api/resources/trending", { token: await tok(env, "s3") })).json();
  check("trending: scoped by department KEY (a 'Dept. of Computer Sciences' student sees CS trending)", trend.resources?.length === 1, JSON.stringify(trend));

  // Dropdown option lists collapse variants
  approvedResource(DB, "v1", { department: "computer science", course: "csc305" });
  approvedResource(DB, "v2", { department: "Computer Science Dept.", course: "CSC-305" });
  approvedResource(DB, "v3", { department: "Mechanical Engineering", course: "MEE 201" });
  const at = await tok(env, "admin1", "admin");
  const fo = await (await call(env, "GET", "/api/admin/resources/filter-options", { token: at })).json();
  check("admin filter-options: ONE entry per department / course however it was typed", fo.departments.length === 2 && fo.courses.length === 2, JSON.stringify(fo));
  approvedResource(DB, "v4", { department: "COMPUTER SCIENCE", course: "CSC 305" });
  const fo2 = await (await call(env, "GET", "/api/admin/resources/filter-options", { token: at })).json();
  check("filter-options: the displayed spelling is the TIDY one even when an ALL-CAPS variant exists (it sorts first)", fo2.departments.includes("Computer Science") && !fo2.departments.includes("COMPUTER SCIENCE") && fo2.departments.length === 2, JSON.stringify(fo2.departments));
  const uo = await (await call(env, "GET", "/api/admin/users/filter-options", { token: at })).json();
  check("admin users filter-options: one entry per department (students' own spellings collapsed)", uo.departments.filter((d) => departmentKey(d) === "computer science").length === 1, JSON.stringify(uo.departments));
  const meta = await (await call(env, "GET", "/api/meta/options", { token: t })).json();
  check("meta options: department suggestions de-duplicated", meta.departments.filter((d) => departmentKey(d) === "computer science").length === 1, JSON.stringify(meta.departments));
  check("meta options: courses filtered by department", (await (await call(env, "GET", "/api/meta/options?department=cs", { token: t })).json()).courses.every((c) => c.startsWith("CSC")));

  // Admin approved-list filters use keys too
  const ap = await (await call(env, "GET", "/api/admin/resources/approved?department=comp%20sci&course=csc%20305&search=csc305", { token: at })).json();
  check("admin approved list: department/course/search match on keys (4 CS rows however typed, not the engineering one)", (ap.resources || []).length === 4, JSON.stringify(ap).slice(0, 200));
}

// =====================================================================================================
// 4. Admin edits can't re-introduce a variant
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  approvedResource(DB, "r1");
  const at = await tok(env, "admin1", "admin");
  const res = await call(env, "PATCH", "/api/admin/resources/r1", { token: at, body: { department: "comp sci", course: "csc-306", session: "2023-24", level: "400 level" } });
  const row = one(DB, "SELECT * FROM resources WHERE id='r1'");
  check("admin edit: accepted", res.status === 200, await res.clone().text());
  check("admin edit: stored canonical (department reuses 'Computer Science', course 'CSC 306', session '2023/2024', level '400')", row.department === "Computer Science" && row.course === "CSC 306" && row.session === "2023/2024" && row.level === "400", JSON.stringify(row));
  check("admin edit: both keys updated together with the text", row.department_key === "computer science" && row.course_key === "CSC306");
  const bad = await call(env, "PATCH", "/api/admin/resources/r1", { token: at, body: { session: "2024/2030" } });
  check("admin edit: an invalid session is rejected, not stored", bad.status === 400);
}

// =====================================================================================================
// 5. Registration stores canonical data; duplicate matric differing by case is refused
// =====================================================================================================
{
  const { env, DB } = world();
  const res = await call(env, "POST", "/api/auth/register", { body: { fullName: " Chi   Okoro ", email: "Chi.Okoro@Gmail.com", password: "password-123", matricNumber: "csc/2021/ 044", university: "uniport", department: "computer  science dept", level: "200 Level", gender: "MALE" } });
  const row = one(DB, "SELECT * FROM users WHERE email = 'chiokoro@gmail.com'");
  check("register: 201", res.status === 201, await res.clone().text());
  check("register: stored canonical", row && row.full_name === "Chi Okoro" && row.matric_number === "CSC/2021/044" && row.department === "Computer Science" && row.department_key === "computer science" && row.level === "200" && row.gender === "Male" && row.university === "Uniport", JSON.stringify(row));
  const dup = await call(env, "POST", "/api/auth/register", { body: { fullName: "Other Person", email: "other@example.com", password: "password-123", matricNumber: "CSC/2021/044" } });
  check("register: same matric number in another style -> 409", dup.status === 409);
}

// =====================================================================================================
// 6. Rejection: reason required, student sees the LABEL (screen, My Uploads, email)
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  DB._raw.prepare("UPDATE users SET preferences = ? WHERE id='uploader'").run(JSON.stringify({ notifications: { uploadStatus: { email: true, inApp: true } } }));
  seedResource(DB, { id: "p1", status: "pending", uploader: "uploader" });
  seedResource(DB, { id: "p2", status: "pending", uploader: "uploader" });
  DB._raw.prepare("INSERT INTO notifications (id,resource_id,recipient_id,type,unread,created_at,updated_at) VALUES ('adm1','p1',NULL,'new_upload',1,?,?)").run(iso(0), iso(0));
  const at = await tok(env, "admin1", "admin");
  const none = await call(env, "POST", "/api/admin/notifications/adm1/reject", { token: at, body: {} });
  check("quick-reject without a reason -> 400 and nothing changes", none.status === 400 && one(DB, "SELECT status s FROM resources WHERE id='p1'").s === "pending");
  sentEmails = [];
  const ok = await call(env, "POST", "/api/admin/notifications/adm1/reject", { token: at, body: { reason: "poor_quality" } });
  check("quick-reject with a reason code -> 200", ok.status === 200);
  const ut = await tok(env, "uploader");
  const notes = await (await call(env, "GET", "/api/notifications/mine", { token: ut })).json();
  const rejectedNote = (notes.notifications || []).find((x) => x.type === "resource_rejected");
  check("student Notifications show the LABEL 'Poor quality', not 'poor_quality'", rejectedNote && rejectedNote.rejectionReason === "Poor quality", JSON.stringify(rejectedNote));
  const mine = await (await call(env, "GET", "/api/resources/my-uploads?status=rejected", { token: ut })).json();
  check("student My Uploads shows the label", mine.resources?.[0]?.rejectionReason === "Poor quality", JSON.stringify(mine.resources?.[0]));
  const emailText = JSON.stringify(sentEmails);
  check("rejection email carries the label, never the raw code", emailText.includes("Poor quality") && !emailText.includes("poor_quality"), emailText.slice(0, 300));
  check("admin lists still carry the CODE (they map it themselves)", (await (await call(env, "GET", "/api/admin/resources/rejected", { token: at })).json()).resources?.[0]?.rejectionReason === "poor_quality");
}

// =====================================================================================================
// 7. A notification failure can't undo an approval or skip its reward
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  setCfg(DB, "live");
  DB._raw.prepare("UPDATE users SET preferences = 'NOT-JSON{{' WHERE id='uploader'").run();
  seedResource(DB, { id: "p1", status: "pending", uploader: "uploader", type: "Past Question" });
  const at = await tok(env, "admin1", "admin");
  const res = await call(env, "POST", "/api/admin/moderation/p1/approve", { token: at, body: { pages: 5, snippet: "" } });
  const body = await res.json();
  check("notify failure: approve still answers 200 (was a 500 for an already-approved resource)", res.status === 200 && body.success, JSON.stringify(body));
  check("notify failure: the reward was still paid", n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE resource_id='p1' AND type='reward'") >= 1);
}

// =====================================================================================================
// 8. Pagination can't be abused
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  for (let i = 0; i < 130; i++) seedResource(DB, { id: "q" + String(i).padStart(3, "0"), status: "pending", uploader: "uploader" });
  const at = await tok(env, "admin1", "admin");
  const q = async (qs) => (await (await call(env, "GET", `/api/admin/moderation/queue${qs}`, { token: at })).json());
  const huge = await q("?limit=100000");
  check("pagination: limit=100000 is capped (100)", (huge.resources || huge.items || huge.queue || []).length === 100, JSON.stringify(Object.keys(huge)));
  const neg = await q("?limit=-1&page=-4");
  check("pagination: a negative limit/page falls back to defaults, never 'no limit'", (neg.resources || neg.items || neg.queue || []).length === 25);
  const junk = await q("?limit=abc&page=xyz");
  check("pagination: non-numeric falls back to defaults", (junk.resources || junk.items || junk.queue || []).length === 25);
  const users = await (await call(env, "GET", "/api/admin/users?limit=99999", { token: at })).json();
  check("pagination: admin users list capped too", users.pagination.limit === 100);
}

// =====================================================================================================
// 9. Admin date filters use the LAGOS day, and a bad date is a 400
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  approvedResource(DB, "late", { reviewedAt: "2026-10-13T23:30:00.000Z" }); // 00:30 on the 14th in Lagos (UTC+1)
  approvedResource(DB, "early", { reviewedAt: "2026-10-14T22:59:00.000Z" }); // 23:59 on the 14th in Lagos
  approvedResource(DB, "next", { reviewedAt: "2026-10-14T23:00:00.000Z" }); // 00:00 on the 15th in Lagos
  const at = await tok(env, "admin1", "admin");
  const day = async (d) => ((await (await call(env, "GET", `/api/admin/resources/approved?approvalDate=${d}`, { token: at })).json()).resources || []).map((r) => r.id).sort();
  check("date filter: 14 Oct (Lagos) = 00:30 and 23:59 that day, not the UTC day", JSON.stringify(await day("2026-10-14")) === JSON.stringify(["early", "late"]), JSON.stringify(await day("2026-10-14")));
  check("date filter: 15 Oct (Lagos) starts at 23:00 UTC", JSON.stringify(await day("2026-10-15")) === JSON.stringify(["next"]));
  const bad = await call(env, "GET", "/api/admin/resources/approved?approvalDate=2026-13-45", { token: at });
  check("date filter: an impossible date -> 400 (was a 500)", bad.status === 400);
  const junk = await call(env, "GET", "/api/admin/resources/rejected?rejectionDate=banana", { token: at });
  check("date filter: junk on the rejected list -> 400 too", junk.status === 400);
}

// =====================================================================================================
// 10. Money from deleted accounts stays in the totals
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "stu");
  const tx = (id, user, type, amount, status = "successful", fromRewards = 0) =>
    DB._raw.prepare("INSERT INTO transactions (id,user_id,type,amount,status,from_rewards,reference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, user, type, amount, status, fromRewards, "ref-" + id, iso(1), iso(1));
  DB._raw.prepare("UPDATE users SET last_login_at = ? WHERE id = 'stu'").run(iso(0));
  tx("t1", "stu", "deposit", 300);
  tx("t2", null, "deposit", 500); // account later deleted: history kept, user_id NULL
  tx("t3", null, "purchase", 120, "successful", 20);
  const at = await tok(env, "admin1", "admin");
  const s = await (await call(env, "GET", "/api/admin/transactions/summary", { token: at })).json();
  check("transactions: deleted-account deposits are included in the total (800, not 300)", s.totalDepositVolume === 800, JSON.stringify(s));
  check("transactions: ...and in total spent (cash part only: 100)", s.totalSpentVolume === 100);
  check("transactions: shown in their own 'deleted' bucket", s.summary.deleted.volume === 500 && s.summary.active.volume === 300, JSON.stringify(s.summary));
  const list = await (await call(env, "GET", "/api/admin/transactions?category=deleted", { token: at })).json();
  check("transactions: list shows them as 'Deleted account'", list.transactions.length === 2 && list.transactions.every((t) => t.user === "Deleted account" && t.category === "deleted"), JSON.stringify(list.transactions));
}

// =====================================================================================================
// 11. Permanent delete takes back the reward, like Remove does
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  setCfg(DB, "live", { ...LIVE_RULES, holdDays: 0 });
  seedResource(DB, { id: "p1", status: "pending", uploader: "uploader", type: "Past Question" });
  const at = await tok(env, "admin1", "admin");
  await call(env, "POST", "/api/admin/moderation/p1/approve", { token: at, body: { pages: 5, snippet: "" } });
  const before = one(DB, "SELECT reward_balance rb, reward_pending rp FROM users WHERE id='uploader'");
  check("perm-delete setup: the student was paid", before.rb + before.rp > 0, JSON.stringify(before));
  const del = await call(env, "DELETE", "/api/admin/resources/p1", { token: at });
  const body = await del.json();
  const after = one(DB, "SELECT reward_balance rb, reward_pending rp FROM users WHERE id='uploader'");
  check("perm-delete: 200 and says rewards were taken back", del.status === 200 && /taken back/i.test(body.message), JSON.stringify(body));
  check("perm-delete: the student's reward is reversed (balance back to 0)", after.rb + after.rp === 0, JSON.stringify(after));
  check("perm-delete: a reversal row exists in the ledger", n(DB, "SELECT COUNT(*) AS n FROM reward_ledger WHERE type='reversal'") >= 1);
}

// =====================================================================================================
// 12. "Inactive" means no ACTIVITY, not "didn't log in this week"
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "daily");
  seedUser(DB, "gone");
  DB._raw.prepare("UPDATE users SET last_login_at = ?, last_active_at = ? WHERE id = 'daily'").run(iso(30), iso(0.01));
  DB._raw.prepare("UPDATE users SET last_login_at = ?, last_active_at = NULL WHERE id = 'gone'").run(iso(30));
  const at = await tok(env, "admin1", "admin");
  const list = await (await call(env, "GET", "/api/admin/users", { token: at })).json();
  const status = (id) => list.users.find((u) => u.id === id)?.effectiveStatus;
  check("inactive: logged in 30 days ago but active today -> ACTIVE", status("daily") === "active", status("daily"));
  check("inactive: no activity for 30 days -> inactive", status("gone") === "inactive");
  check("inactive: 'active this week' counts activity, not just logins", list.stats.activeThisWeek === 1, JSON.stringify(list.stats));

  // protect.js records activity (throttled to once an hour)
  const gt = await tok(env, "gone");
  await call(env, "GET", "/api/users/me", { token: gt });
  const touched = one(DB, "SELECT last_active_at a FROM users WHERE id='gone'").a;
  check("activity: an authenticated request records last_active_at", touched && Date.now() - Date.parse(touched) < 60000, String(touched));
  const dt = await tok(env, "daily");
  const was = one(DB, "SELECT last_active_at a FROM users WHERE id='daily'").a;
  await call(env, "GET", "/api/users/me", { token: dt });
  check("activity: throttled - not rewritten within the hour", one(DB, "SELECT last_active_at a FROM users WHERE id='daily'").a === was);
}

// =====================================================================================================
// 13. Announcements: validated, matched by department key, verified students only
// =====================================================================================================
{
  const { env, DB } = world();
  const mk = (id, dept, level = "300", verified = 1, status = "active") => { seedUser(DB, id, { department: dept, level, verified, status }); DB._raw.prepare("UPDATE users SET department_key = ? WHERE id = ?").run(dept ? departmentKey(dept) : null, id); };
  mk("a", "Computer Science"); mk("b", "computer science"); mk("c", "Dept. of Computer Sciences"); mk("d", "Physics"); mk("e", "Computer Science", "300", 0); mk("f", "Computer Science", "300", 1, "suspended"); mk("g", "Computer Science", "200");
  const at = await tok(env, "admin1", "admin");
  const send = (body) => call(env, "POST", "/api/admin/announcements", { token: at, body });
  const ok = await send({ title: "  Exam   week ", message: "Good luck", departments: ["comp sci"], levels: ["300 Level"] });
  const b = await ok.json();
  check("announcement: targets every spelling of the department (a, b, c) at level 300, not unverified/suspended/other", ok.status === 201 && b.announcement.recipientCount === 3, JSON.stringify(b));
  const raw = await call(env, "POST", "/api/admin/announcements", { token: at, body: undefined });
  check("announcement: empty body -> 400 (was 500)", raw.status === 400);
  const badJson = await app.fetch(new Request("http://localhost/api/admin/announcements", { method: "POST", headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" }, body: "{nope" }), env, { waitUntil() {} });
  check("announcement: malformed JSON -> 400", badJson.status === 400);
  check("announcement: departments as a string -> 400 (was a crash)", (await send({ title: "t", message: "m", departments: "CS" })).status === 400);
  check("announcement: unknown level -> 400", (await send({ title: "t", message: "m", levels: ["999"] })).status === 400);
  check("announcement: too many departments -> 400 (D1's 100-parameter limit)", (await send({ title: "t", message: "m", departments: Array.from({ length: 60 }, (_, i) => "Dept " + i) })).status === 400);
  check("announcement: missing title -> 400", (await send({ message: "m" })).status === 400);
}

// =====================================================================================================
// 14. Upload permits: stale slots are reclaimed, cancel frees a slot immediately
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "stu");
  const u = { id: "stu" };
  const meta = { type: "Past Question", department: "Computer Science", course: "CSC 305", level: "300", semester: "First", session: "2024/2025", title: "T" };
  const permit = (i = 0) => requestUploadPermit(ctx(env, { user: u, body: { fileName: `f${i}.pdf`, fileSize: 5000, ...meta } }));
  const intent = (id, minutesAgo) => DB._raw.prepare("INSERT INTO upload_intents (id,user_id,public_id,file_name,file_extension,declared_size,metadata,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, "stu", `sharef_resources/${id}.pdf`, "f.pdf", "pdf", 1, "{}", new Date(Date.now() - minutesAgo * 60000).toISOString(), new Date(Date.now() + (30 - minutesAgo) * 60000).toISOString());
  intent("i1", 1); intent("i2", 1); intent("i3", 1);
  check("permits: 3 fresh in-flight uploads -> a 4th is refused (429)", (await permit(1)).status === 429);
  DB._raw.prepare("DELETE FROM upload_intents").run();
  intent("o1", 15); intent("o2", 14); intent("o3", 12); // started 12-15 minutes ago and never finished
  const after = await permit(2);
  check("permits: three ABANDONED attempts no longer lock the student out for 30 minutes", after.status === 200, JSON.stringify(after.body));
  DB._raw.prepare("DELETE FROM upload_intents").run();
  intent("c1", 1); intent("c2", 1); intent("c3", 1);
  const cancel = await cancelUpload(ctx(env, { user: u, body: { intentId: "c1" } }));
  check("permits: cancel releases the slot at once", cancel.body.success && n(DB, "SELECT COUNT(*) AS n FROM upload_intents WHERE id='c1'") === 0 && (await permit(3)).status === 200);
  const steal = await cancelUpload(ctx(env, { user: { id: "someone-else" }, body: { intentId: "c2" } }));
  check("permits: you can't cancel someone else's intent", n(DB, "SELECT COUNT(*) AS n FROM upload_intents WHERE id='c2'") === 1 && steal.body.success === true);
}

// =====================================================================================================
// 15. The one-off normaliser repairs legacy data, is paged, and is idempotent
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "uploader");
  const ins = (id, dept, course, o = {}) => DB._raw.prepare(`INSERT INTO resources (id,title,type,department,department_key,course,course_key,level,semester,session,uploader_id,file_name,file_url,cloudinary_public_id,file_size_bytes,file_extension,pages,status,created_at,updated_at)
      VALUES (?,?,?,?,NULL,?,NULL,?,?,?,'uploader','f.pdf','u','p',1,'pdf',1,'approved',?,?)`).run(id, "  Old   title ", "Past Question", dept, course, "300", "First", o.session ?? "2024-25", iso(1), iso(1));
  ins("l1", "computer science", "csc305"); ins("l2", "  COMPUTER   SCIENCE ", "CSC-305"); ins("l3", "Computer Science Dept.", "csc 305"); ins("l4", "physics", "phy101", { session: "Harmattan 2024" });
  seedUser(DB, "m1"); seedUser(DB, "m2"); seedUser(DB, "m3");
  DB._raw.prepare("UPDATE users SET matric_number = 'csc/1', department = ' comp sci ', university = 'UNIPORT  rivers' WHERE id = 'm1'").run();
  DB._raw.prepare("UPDATE users SET matric_number = 'CSC/2' WHERE id = 'm2'").run();
  DB._raw.prepare("UPDATE users SET matric_number = 'csc/2' WHERE id = 'm3'").run(); // would collide with m2 once normalised

  const at = await tok(env, "admin1", "admin");
  const run = async (body) => (await (await call(env, "POST", "/api/admin/maintenance/normalize-academic-data", { token: at, body })).json());
  const p1 = await run({ table: "resources", limit: 2 });
  check("normaliser: pages through the data (more remain after 2 of 4)", p1.success && p1.done === false && p1.next?.after, JSON.stringify(p1));
  const p2 = await run(p1.next ? { ...p1.next, limit: 2 } : {});
  const p3 = await run({ table: "resources", after: p2.lastId, limit: 2 });
  check("normaliser: finishes resources and points at users", p2.scanned === 2 && p3.done === true && p3.next?.table === "users", JSON.stringify([p2, p3]));
  const rows = all(DB, "SELECT * FROM resources ORDER BY id");
  check("normaliser: every spelling of Computer Science is now ONE department with ONE key", new Set(rows.filter((r) => r.id !== "l4").map((r) => r.department)).size === 1 && new Set(rows.filter((r) => r.id !== "l4").map((r) => r.department_key)).size === 1 && rows[0].department === "Computer Science", JSON.stringify(rows.map((r) => [r.department, r.department_key])));
  check("normaliser: course / course key / session / title tidied", rows[0].course === "CSC 305" && rows[0].course_key === "CSC305" && rows[0].session === "2024/2025" && rows[0].title === "Old title", JSON.stringify(rows[0]));
  check("normaliser: values it can't understand are LEFT ALONE (never blanked)", rows[3].session === "Harmattan 2024" && rows[3].department === "Physics" && rows[3].course === "PHY 101");
  const u1 = await run({ table: "users", limit: 100 });
  const m1 = one(DB, "SELECT * FROM users WHERE id='m1'");
  check("normaliser (users): matric/department/university tidied", m1.matric_number === "CSC/1" && m1.department === "Computer Science" && m1.department_key === "computer science" && m1.university === "Uniport Rivers", JSON.stringify(m1));
  check("normaliser (users): a matric collision is reported and left, never overwritten", u1.conflicts.length === 1 && u1.conflicts[0].userId === "m3" && one(DB, "SELECT matric_number m FROM users WHERE id='m3'").m === "csc/2", JSON.stringify(u1.conflicts));
  const again = await run({ table: "resources", limit: 200 });
  check("normaliser: re-running changes nothing (idempotent)", again.changed === 0, JSON.stringify(again));
}

// =====================================================================================================
// 16. Bounty permit refuses a wrong type through the route as well (see also phase6b/6c tests)
// =====================================================================================================
{
  const { env, DB } = world();
  seedUser(DB, "stu");
  seedBounty(DB, { id: "B1", course: "CSC 305", type: "Past Questions", level: "300 Level" });
  const mk = (type) => requestUploadPermit(ctx(env, { user: { id: "stu" }, body: { fileName: "a.pdf", fileSize: 100, type, department: "Computer Science", course: "csc305", level: "300", semester: "First", session: "2024/2025", title: "T", bountyId: "B1" } }));
  const good = await mk("Past Question");
  const bad = await mk("Textbook");
  const bound = (r) => JSON.parse(one(DB, "SELECT metadata m FROM upload_intents WHERE id = ?", r.body.intentId).m).bountyId ?? null;
  check("bounty: matching type keeps the request attached", bound(good) === "B1");
  check("bounty: a Textbook upload for a Past Questions request is silently NOT attached", bound(bad) === null);
}

summary();
