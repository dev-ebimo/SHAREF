// Browser-side compression support: the compression-proof duplicate fingerprint and the (informational)
// original size.
//   - approval accepts/validates `contentFingerprint` and stores it as resources.content_fp
//   - the reward engine treats a resource as a duplicate when EITHER fingerprint matches an approved one
//   - the permit accepts an optional `originalSize`, stores it, and drops bad values without failing
// Run: node test/content-fingerprint.test.js
import { sign } from "hono/jwt";
import app from "../src/index.js";
import { createMockD1 } from "./mockD1.js";
import { check, summary, freshEnv, ctx, one, setCfg, seedUser, seedResource, schemaSql } from "./incentiveTestLib.js";
import { approveResourceById, parseApprovalReview } from "../src/controllers/moderationController.js";

const A1 = { id: "admin1", role: "admin" };
const HEX = (c) => c.repeat(64);
const FP = (kind, c) => `${kind}:${HEX(c)}`;

// ------------------------------------------------------------------ parsing / validation
{
  const P = (b) => parseApprovalReview({ pages: 3, ...b });
  check("parse: valid ooxml1 fingerprint accepted", P({ contentFingerprint: FP("ooxml1", "a") }).contentFp === FP("ooxml1", "a"));
  check("parse: valid pdftext1 fingerprint accepted", P({ contentFingerprint: FP("pdftext1", "b") }).contentFp === FP("pdftext1", "b"));
  check("parse: uppercase hex is normalised to lowercase", P({ contentFingerprint: "ooxml1:" + "ABCDEF0123456789".repeat(4) }).contentFp === "ooxml1:" + "abcdef0123456789".repeat(4));
  check("parse: surrounding whitespace tolerated", P({ contentFingerprint: `  ${FP("ooxml1", "c")}\n` }).contentFp === FP("ooxml1", "c"));
  const junk = [
    ["unknown kind", "zipx9:" + HEX("a")], ["no kind", HEX("a")], ["too short", "ooxml1:" + "a".repeat(63)], ["too long", "ooxml1:" + "a".repeat(65)],
    ["non-hex", "ooxml1:" + "g".repeat(64)], ["sql-ish", "ooxml1:" + HEX("a") + "'; DROP TABLE resources;--"], ["empty", ""], ["number", 12345], ["null", null], ["object", { a: 1 }], ["array", [FP("ooxml1", "a")]],
  ];
  for (const [label, v] of junk) check(`parse: ${label} is IGNORED (null), not an error`, (() => { const r = P({ contentFingerprint: v }); return !r.error && r.contentFp === null; })());
  check("parse: legacy body without the field still valid", (() => { const r = P({}); return !r.error && r.contentFp === null && r.fileHash === null; })());
  check("parse: fileHash handling unchanged", P({ fileHash: HEX("d") }).fileHash === HEX("d"));
}

// ------------------------------------------------------------------ storing at approval
const world = (status = "live") => {
  const w = freshEnv();
  seedUser(w.DB, "admin1", { name: "Admin One", role: "admin" });
  seedUser(w.DB, "stu", { name: "Student One" });
  seedUser(w.DB, "other", { name: "Student Two" });
  setCfg(w.DB, status);
  return w;
};
const pend = (DB, id, o = {}) => seedResource(DB, { id, status: "pending", uploader: "stu", ...o });
const approve = (env, id, review = {}) =>
  approveResourceById(ctx(env, { user: A1 }), id, { pages: 5, snippet: "", rewardTier: undefined, rewardNote: "", fileHash: null, contentFp: null, ...review });
const fpOf = (DB, id) => one(DB, "SELECT content_fp AS f, file_hash AS h FROM resources WHERE id = ?", id);

{
  const { env, DB } = world("off");
  pend(DB, "s1"); pend(DB, "s2"); pend(DB, "s3");
  await approve(env, "s1", { contentFp: FP("ooxml1", "a"), fileHash: HEX("1") });
  check("approve: stores content_fp (and file_hash) on the resource", fpOf(DB, "s1").f === FP("ooxml1", "a") && fpOf(DB, "s1").h === HEX("1"));
  await approve(env, "s2", {});
  check("approve: no fingerprint supplied leaves content_fp NULL", fpOf(DB, "s2").f === null);
  DB._raw.prepare("UPDATE resources SET content_fp = ? WHERE id = 's3'").run(FP("pdftext1", "e"));
  await approve(env, "s3", {});
  check("approve: omitting the fingerprint never wipes an existing one (COALESCE)", fpOf(DB, "s3").f === FP("pdftext1", "e"));
}

// ------------------------------------------------------------------ duplicate rule in the reward engine
{
  const { env, DB } = world("live");
  ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].forEach((id) => pend(DB, id));
  pend(DB, "o1", { uploader: "other" });
  const C = FP("ooxml1", "c");

  const first = await approve(env, "a1", { fileHash: HEX("1"), contentFp: C });
  check("dup: the first copy is paid", first.body.reward.status === "paid", JSON.stringify(first.body.reward));

  // THE point of the feature: same original, compressed differently -> different file bytes (hash), same content.
  const recompressed = await approve(env, "a2", { fileHash: HEX("2"), contentFp: C });
  check("dup: same content fingerprint but DIFFERENT file hash is a duplicate (compression-proof)",
    recompressed.body.reward.status === "blocked" && /already approved/.test(recompressed.body.message), JSON.stringify(recompressed.body));
  const other = await approve(env, "o1", { fileHash: HEX("3"), contentFp: C });
  check("dup: also when a different student uploads it", other.body.reward.status === "blocked");

  const exact = await approve(env, "a3", { fileHash: HEX("1"), contentFp: null });
  check("dup: the old exact-hash rule still works on its own (no content fingerprint)", exact.body.reward.status === "blocked");
  const exact2 = await approve(env, "a7", { fileHash: HEX("1"), contentFp: FP("ooxml1", "9") });
  check("dup: matching file hash is enough even if the content fingerprint differs", exact2.body.reward.status === "blocked");

  const different = await approve(env, "a4", { fileHash: HEX("4"), contentFp: FP("ooxml1", "d") });
  check("dup: different hash AND different content fingerprint -> paid", different.body.reward.status === "paid");
  const unknown = await approve(env, "a5", {});
  check("dup: no fingerprints at all -> can't tell, so paid (unchanged behaviour)", unknown.body.reward.status === "paid");

  // fingerprint kinds are namespaced: identical hex under a different kind is NOT the same document
  const otherKind = await approve(env, "a6", { fileHash: HEX("6"), contentFp: FP("pdftext1", "c") });
  // (asserted on the REASON: this student may already be at their weekly reward cap by now, which is unrelated)
  check("dup: same hex under a different fingerprint kind is NOT a duplicate", !/already approved/.test(otherKind.body.message || "") && !/already approved/.test(otherKind.body.reward?.message || ""), JSON.stringify(otherKind.body));
}
{
  // a PENDING or REJECTED resource must never make a later upload look like a duplicate
  const { env, DB } = world("live");
  const C = FP("pdftext1", "f");
  seedResource(DB, { id: "p0", status: "pending", uploader: "other" }); DB._raw.prepare("UPDATE resources SET content_fp = ? WHERE id = 'p0'").run(C);
  seedResource(DB, { id: "r0", status: "rejected", uploader: "other" }); DB._raw.prepare("UPDATE resources SET content_fp = ? WHERE id = 'r0'").run(C);
  pend(DB, "n1");
  const r = await approve(env, "n1", { contentFp: C });
  check("dup: matching content_fp on a pending/rejected resource is ignored (only APPROVED counts)", r.body.reward.status === "paid", JSON.stringify(r.body.reward));
}

// ------------------------------------------------------------------ permit / complete: informational original size
const SECRET = "test-secret";
function httpEnv() {
  const DB = createMockD1(schemaSql);
  return { env: { DB, JWT_SECRET: SECRET, CLOUDINARY_CLOUD_NAME: "sharef-cloud", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s", SENDGRID_API_KEY: "SG.x", SENDGRID_FROM_EMAIL: "n@s.test" }, DB };
}
const waitCtx = { waitUntil() {}, passThroughOnException() {} };
const tok = (id, role = "student") => { const now = Math.floor(Date.now() / 1000); return sign({ id, role, iat: now, exp: now + 3600 }, SECRET); };
const post = (env, path, body, token) =>
  app.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), env, waitCtx);
const META = { title: "Compressed Notes", type: "Lecture Note", department: "Computer Science", course: "CSC 301", level: "300", semester: "First", session: "2024/2025", description: "" };

const realFetch = globalThis.fetch;
let stored = new Map();
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), P = "https://res.cloudinary.com/sharef-cloud/raw/upload/";
  if (u.startsWith(P)) {
    const f = stored.get(u.slice(P.length)); if (!f) return new Response("nf", { status: 404 });
    return new Response(f.slice(0, 8), { status: 206, headers: { "Content-Range": `bytes 0-7/${f.length}` } });
  }
  return realFetch(url, opts);
};
try {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0]);
  const { env, DB } = httpEnv();
  seedUser(DB, "stu"); seedUser(DB, "stu2");
  const t = await tok("stu");

  async function upload(over, userTok = t) {
    const pr = await post(env, "/api/resources/upload/permit", { ...META, fileName: "notes.pdf", fileSize: 4_000_000, ...over }, userTok);
    const pj = await pr.json();
    if (!pj.success) return { pr, pj };
    stored.set(pj.upload.fields.public_id, PDF);
    const cr = await post(env, "/api/resources/upload/complete", { intentId: pj.intentId }, userTok);
    return { pr, pj, cr, cj: await cr.json() };
  }

  const good = await upload({ originalSize: 17_000_000 });
  check("permit+complete with originalSize succeeds", good.pr.status === 200 && good.cr.status === 201, JSON.stringify(good.cj));
  check("originalSize is stored on the resource (informational)", one(DB, "SELECT original_size_bytes AS o, file_size_bytes AS s FROM resources WHERE id = ?", good.pj.intentId).o === 17_000_000);
  check("the STORED size is still taken from the file Cloudinary actually holds, not from the client", one(DB, "SELECT file_size_bytes AS s FROM resources WHERE id = ?", good.pj.intentId).s === PDF.length);

  const none = await upload({});
  check("permit without originalSize still works (old clients) and stores NULL", none.cr.status === 201 && one(DB, "SELECT original_size_bytes AS o FROM resources WHERE id = ?", none.pj.intentId).o === null);

  for (const [label, v] of [["zero", 0], ["negative", -5], ["float", 12.5], ["string", "17000000"], ["null", null], ["huge (> 200MB)", 5_000_000_000], ["object", {}]]) {
    const r = await upload({ originalSize: v }, await tok("stu2"));
    check(`originalSize ${label}: dropped to NULL, upload NOT rejected`, r.pr.status === 200 && r.cr?.status === 201 && one(DB, "SELECT original_size_bytes AS o FROM resources WHERE id = ?", r.pj.intentId).o === null, JSON.stringify(r.pj));
  }

  check("the 8MB limit on the file that is actually STORED is unchanged", (await upload({ fileSize: 9 * 1024 * 1024, originalSize: 30_000_000 })).pr.status === 400);
} finally {
  globalThis.fetch = realFetch;
}

summary();
