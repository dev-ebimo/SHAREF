// Phase 6b (update package, Phase 2): hooks into existing flows (upload bounty, moderation, my-uploads, signup/referral, deletion cascades)
// Controller-level tests: real controllers + real schema.sql in SQLite, with a fake request context.
// Run: node --experimental-sqlite test/phase6b-incentives-hooks.test.js
import { check, summary, freshEnv, ctx, one, all, n, iso, setCfg, seedUser, seedResource, seedLedger, seedBounty, LIVE_RULES } from "./incentiveTestLib.js";
import { resolveBountyForUpload } from "../src/services/bountyService.js";
import { requestUploadPermit, completeUpload } from "../src/controllers/uploadController.js";
import { getModerationQueue, parseApprovalReview, approveResourceById } from "../src/controllers/moderationController.js";
import { getMyUploads } from "../src/controllers/resourceController.js";
import { register, verifyOTP } from "../src/controllers/authController.js";
import { deleteMyAccount } from "../src/controllers/userSettingsController.js";
import { permanentlyDeleteResource } from "../src/controllers/adminResourceController.js";
import { captureReferral, markReferralVerified } from "../src/services/referralService.js";
import { hashOtp } from "../src/utils/otp.js";

// Network stub: Cloudinary range check (206 + a PDF header), everything else (destroy, email) succeeds.
globalThis.fetch = async (_url, init = {}) => {
  if (init.headers && init.headers.Range) {
    return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]), { status: 206, headers: { "content-range": "bytes 0-7/12345" } });
  }
  return new Response(JSON.stringify({ result: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
};
const admin = { id: "admin1", role: "admin" };
const world = () => { const w = freshEnv(); seedUser(w.DB, "admin1", { name: "Admin One", role: "admin" }); seedUser(w.DB, "uploader"); return w; };

// ============ resolveBountyForUpload
{
  const { DB } = world();
  const ok = seedBounty(DB, { id: "ok", course: "CSC 305" });
  seedBounty(DB, { id: "exp", course: "CSC 305", expires: iso(1) }); seedBounty(DB, { id: "clo", course: "CSC 305", status: "closed" }); seedBounty(DB, { id: "ful", course: "CSC 305", max: 1, paid: 1 });
  check("bounty: valid id + same course → accepted", (await resolveBountyForUpload(DB, "ok", "CSC 305")) === "ok");
  check("bounty: course matched ignoring case/spacing/punctuation", (await resolveBountyForUpload(DB, "ok", "csc305")) === "ok" && (await resolveBountyForUpload(DB, " ok ", "Csc-305")) === "ok");
  check("bounty: wrong course → null", (await resolveBountyForUpload(DB, "ok", "MTH 101")) === null);
  check("bounty: expired / closed / fully-paid → null", [(await resolveBountyForUpload(DB, "exp", "CSC 305")), (await resolveBountyForUpload(DB, "clo", "CSC 305")), (await resolveBountyForUpload(DB, "ful", "CSC 305"))].every((x) => x === null));
  check("bounty: junk (missing, number, object, huge string) → null, never throws", [undefined, null, 7, {}, "", "x".repeat(500)].every((v) => true) && (await Promise.all([undefined, null, 7, {}, "", "x".repeat(500)].map((v) => resolveBountyForUpload(DB, v, "CSC 305")))).every((x) => x === null));
}

// ============ upload permit + complete (executes the modified INSERT for real)
{
  const { env, DB } = world();
  seedBounty(DB, { id: "BNT", course: "CSC 305" });
  const meta = { title: "CSC 305 Past Questions", type: "Past Question", department: "Computer Science", course: "CSC 305", level: "300", semester: "First", session: "2024/2025", description: "d" };
  const permit = async (extra = {}, userId = "uploader") => requestUploadPermit(ctx(env, { user: { id: userId, role: "student" }, body: { fileName: "pq.pdf", fileSize: 12345, ...meta, ...extra } }));
  const complete = async (intentId, userId = "uploader") => completeUpload(ctx(env, { user: { id: userId, role: "student" }, body: { intentId } }));

  let r = await permit({ bountyId: "BNT" });
  check("permit: with a valid request id → 200 and the id is kept on the upload intent", r.status === 200 && r.body.success && JSON.parse(one(DB, "SELECT metadata FROM upload_intents WHERE id=?", r.body.intentId).metadata).bountyId === "BNT");
  let c1 = await complete(r.body.intentId);
  const res1 = one(DB, "SELECT bounty_id, status, uploader_id, pages FROM resources WHERE id=?", r.body.intentId);
  check("complete: resource row inserted (modified INSERT works) with bounty_id set", (c1.status === 201 || c1.status === 200) && c1.body.success !== false && res1 && res1.bounty_id === "BNT" && res1.status === "pending" && res1.uploader_id === "uploader", JSON.stringify([c1.status, c1.body, res1]));
  check("complete: still creates the admin notification and clears the intent", n(DB, "SELECT COUNT(*) AS n FROM notifications WHERE resource_id=? AND type='new_upload'", r.body.intentId) === 1 && n(DB, "SELECT COUNT(*) AS n FROM upload_intents WHERE id=?", r.body.intentId) === 0);
  const again = await complete(r.body.intentId);
  check("complete: double-submit is still idempotent (200, one resource)", again.status === 200 && n(DB, "SELECT COUNT(*) AS n FROM resources WHERE id=?", r.body.intentId) === 1);

  r = await permit({ bountyId: "BNT", course: "MTH 101" });
  check("permit: request id for a DIFFERENT course is silently dropped (upload still proceeds)", r.status === 200 && !("bountyId" in JSON.parse(one(DB, "SELECT metadata FROM upload_intents WHERE id=?", r.body.intentId).metadata)));
  r = await permit({ bountyId: "does-not-exist" });
  check("permit: unknown request id silently dropped", r.status === 200 && !("bountyId" in JSON.parse(one(DB, "SELECT metadata FROM upload_intents WHERE id=?", r.body.intentId).metadata)));
  await complete(r.body.intentId);
  check("complete: a normal upload gets bounty_id NULL", one(DB, "SELECT bounty_id b FROM resources WHERE id=?", r.body.intentId).b === null);
  r = await permit({ bountyId: { evil: true } });
  check("permit: non-string bountyId can't break the upload", r.status === 200);
  r = await permit();
  check("permit: no bountyId at all — existing behaviour unchanged", r.status === 200 && r.body.upload && r.body.intentId);
}

// ============ moderation queue / parse / approve
{
  const { env, DB } = world();
  const mkUser = (id, o = {}) => seedUser(DB, id, o);
  mkUser("clean"); mkUser("flagged"); mkUser("rej3"); mkUser("rej1"); mkUser("old-rej"); mkUser("newbie", { created: iso(2) });
  mkUser("tw1", { ip: "iphash-shared" }); mkUser("tw2", { ip: "iphash-shared" }); mkUser("solo", { ip: "iphash-solo" });
  DB._raw.prepare("INSERT INTO incentive_flags (id,user_id,status,created_at,updated_at) VALUES ('fl','flagged','open',?,?)").run(iso(0), iso(0));
  let k = 0;
  const rejected = (uid, daysAgo) => seedResource(DB, { id: "rj" + ++k, uploader: uid, status: "rejected", reviewedAt: iso(daysAgo) });
  [1, 2, 3].forEach((d) => rejected("rej3", d)); rejected("rej1", 5); rejected("old-rej", 20);
  seedBounty(DB, { id: "BOK", reward: 120 }); seedBounty(DB, { id: "BCL", status: "closed" }); seedBounty(DB, { id: "BEX", expires: iso(1) }); seedBounty(DB, { id: "BFU", max: 1, paid: 1 });
  const pend = (id, uploader, bountyId = null, createdAt = iso(0.5)) => seedResource(DB, { id, status: "pending", uploader, bountyId, createdAt });
  pend("q-clean", "clean"); pend("q-flag", "flagged"); pend("q-rej3", "rej3"); pend("q-rej1", "rej1"); pend("q-oldrej", "old-rej"); pend("q-new", "newbie");
  pend("q-tw1", "tw1"); pend("q-solo", "solo"); pend("q-bok", "clean", "BOK"); pend("q-bcl", "clean", "BCL"); pend("q-bex", "clean", "BEX"); pend("q-bfu", "clean", "BFU");

  const queue = async () => { const r = await getModerationQueue(ctx(env, { user: admin, query: { limit: "50" } })); return Object.fromEntries(r.body.queue.map((q) => [q.id, q])); };
  const BASE = "course,dept,id,isAged,level,semester,session,size,title,type,uploadDate,uploader";

  let q = await queue();
  check("queue(off): items carry EXACTLY the original fields — no bounty/uploaderRisk keys leak", Object.values(q).every((i) => Object.keys(i).sort().join() === BASE) && Object.keys(q).length === 12);
  setCfg(DB, "shadow");
  q = await queue();
  check("queue(shadow): reward context appears", Object.values(q).every((i) => i.uploaderRisk && Array.isArray(i.uploaderRisk.notes)));
  check("queue: clean old account → low, no notes", q["q-clean"].uploaderRisk.level === "low" && q["q-clean"].uploaderRisk.notes.length === 0);
  check("queue: open reward flag → HIGH", q["q-flag"].uploaderRisk.level === "high" && q["q-flag"].uploaderRisk.notes.some((x) => /open reward flag/i.test(x)));
  check("queue: 3 rejections in 14 days → HIGH with a count", q["q-rej3"].uploaderRisk.level === "high" && q["q-rej3"].uploaderRisk.notes.some((x) => /3 uploads rejected/.test(x)));
  check("queue: 1 recent rejection → medium", q["q-rej1"].uploaderRisk.level === "medium");
  check("queue: a rejection older than 14 days is ignored → low", q["q-oldrej"].uploaderRisk.level === "low");
  check("queue: account under 7 days old → medium, says how old", q["q-new"].uploaderRisk.level === "medium" && q["q-new"].uploaderRisk.notes.some((x) => /2 day/.test(x)));
  check("queue: shares a signup connection with another account → medium; unique connection → low", q["q-tw1"].uploaderRisk.level === "medium" && q["q-solo"].uploaderRisk.level === "low");
  check("queue: a payable request is surfaced as bounty {id,reward}", q["q-bok"].bounty && q["q-bok"].bounty.id === "BOK" && q["q-bok"].bounty.reward === 120);
  check("queue: closed / expired / fully-paid requests are NOT surfaced", !q["q-bcl"].bounty && !q["q-bex"].bounty && !q["q-bfu"].bounty && !q["q-clean"].bounty);
  check("queue: pagination/total unaffected by the extra context", (await getModerationQueue(ctx(env, { user: admin, query: { limit: "5", page: "2" } }))).body.queue.length === 5);

  // parseApprovalReview
  const P = parseApprovalReview;
  const legacy = P({ pages: 12, snippet: "hello" });
  check("parse: the EXISTING approve body {pages,snippet} is still valid and unchanged in meaning", !legacy.error && legacy.pages === 12 && legacy.snippet === "hello" && legacy.rewardTier === undefined && legacy.fileHash === null);
  check("parse: pages still required", !!P({ snippet: "x" }).error && !!P({ pages: 0 }).error);
  check("parse: valid reward tiers accepted", ["bounty", "standard", "none"].every((t) => P({ pages: 3, rewardTier: t }).rewardTier === t));
  check("parse: unknown tier → clear error", /valid reward/i.test(P({ pages: 3, rewardTier: "mega" }).error));
  check("parse: high/rare need a reason (≥5 chars)", !!P({ pages: 3, rewardTier: "high" }).error && !!P({ pages: 3, rewardTier: "rare", rewardNote: "abc" }).error && !P({ pages: 3, rewardTier: "rare", rewardNote: "Not on Sharef yet" }).error);
  check("parse: reward note sanitised and trimmed", P({ pages: 3, rewardTier: "standard", rewardNote: "  a\u0000b\n\n c  " }).rewardNote === "a b c");
  const H = "A".repeat(64);
  check("parse: valid SHA-256 hex accepted (lower-cased); malformed hash is IGNORED, not an error", P({ pages: 3, fileHash: H }).fileHash === "a".repeat(64) && P({ pages: 3, fileHash: "nope" }).fileHash === null && !P({ pages: 3, fileHash: 123 }).error);

  // approve persists the hash; legacy approve untouched
  const a = ctx(env, { user: admin });
  const r1 = await approveResourceById(a, "q-clean", P({ pages: 9, snippet: "s", fileHash: H }));
  check("approve: succeeds and stores the file hash", r1.status === 200 && one(DB, "SELECT file_hash h, status, pages FROM resources WHERE id='q-clean'").h === "a".repeat(64) && one(DB, "SELECT status FROM resources WHERE id='q-clean'").status === "approved");
  const r2 = await approveResourceById(ctx(env, { user: admin }), "q-solo", P({ pages: 4, snippet: "" }));
  check("approve: legacy body works and leaves file_hash NULL", r2.status === 200 && one(DB, "SELECT file_hash h FROM resources WHERE id='q-solo'").h === null);
  seedResource(DB, { id: "had", status: "pending", uploader: "clean", hash: "b".repeat(64) });
  await approveResourceById(ctx(env, { user: admin }), "had", P({ pages: 2 }));
  check("approve: no hash supplied never wipes an existing one (COALESCE)", one(DB, "SELECT file_hash h FROM resources WHERE id='had'").h === "b".repeat(64));
  const r3 = await approveResourceById(ctx(env, { user: admin }), "q-clean", P({ pages: 9 }));
  check("approve: second approval of the same item still 409", r3.status === 409);
}

// ============ my-uploads reward chips
{
  const { env, DB } = world();
  seedUser(DB, "me");
  const mk = (id, status, type = "Past Question", bountyId = null, createdAt = iso(1)) => seedResource(DB, { id, status, type, uploader: "me", bountyId, createdAt });
  seedBounty(DB, { id: "B200", reward: 200 }); seedBounty(DB, { id: "BCLOSED", reward: 200, status: "closed" });
  mk("pend-pq", "pending"); mk("pend-ln-bounty", "pending", "Lecture Note", "B200"); mk("pend-ln-closed", "pending", "Lecture Note", "BCLOSED"); mk("pend-other", "pending", "Other");
  mk("ap-paid", "approved"); mk("ap-clear", "approved"); mk("ap-rev", "approved"); mk("ap-shadow", "approved"); mk("rej", "rejected");
  seedLedger(DB, { user: "me", amount: 100, status: "pending", resource: "ap-paid", tier: "standard" });
  seedLedger(DB, { user: "me", amount: 50, status: "cleared", resource: "ap-paid", tier: "first" });
  seedLedger(DB, { user: "me", amount: 100, status: "cleared", resource: "ap-clear", tier: "standard" });
  seedLedger(DB, { user: "me", amount: 100, status: "reversed", resource: "ap-rev", tier: "standard" });
  seedLedger(DB, { user: "me", amount: 100, status: "shadow", resource: "ap-shadow", tier: "standard" });
  seedLedger(DB, { user: "me", amount: 100, status: "cleared", resource: "rej", tier: "standard" });
  const get = async () => Object.fromEntries((await getMyUploads(ctx(env, { user: { id: "me" }, query: {} }))).body.resources.map((r) => [r.id, r]));

  for (const s of ["off", "shadow"]) { setCfg(DB, s); const g = await get(); check(`my-uploads(${s}): no resource has a reward chip (output unchanged)`, Object.values(g).every((r) => !("reward" in r)) && Object.keys(g).length === 9); }
  setCfg(DB, "live");
  const g = await get();
  check("my-uploads(live): pending past question → 'up to' standard amount, no status", g["pend-pq"].reward.amount === 100 && g["pend-pq"].reward.status === undefined);
  check("my-uploads(live): pending upload answering an open request → the larger request reward", g["pend-ln-bounty"].reward.amount === 200);
  check("my-uploads(live): closed request ignored → standard lecture-note amount", g["pend-ln-closed"].reward.amount === 60);
  check("my-uploads(live): types with no standard reward get no chip", !("reward" in g["pend-other"]));
  check("my-uploads(live): approved with pending+cleared parts → summed, status 'pending' (still clearing)", g["ap-paid"].reward.amount === 150 && g["ap-paid"].reward.status === "pending");
  check("my-uploads(live): approved & cleared → {100,'cleared'}", g["ap-clear"].reward.amount === 100 && g["ap-clear"].reward.status === "cleared");
  check("my-uploads(live): reversed reward → {100,'reversed'}", g["ap-rev"].reward.amount === 100 && g["ap-rev"].reward.status === "reversed");
  check("my-uploads(live): shadow-only ledger never shown to the student", !("reward" in g["ap-shadow"]));
  check("my-uploads(live): rejected upload has no chip even if a row exists", !("reward" in g["rej"]));
  setCfg(DB, "paused");
  check("my-uploads(paused): chips still shown", "reward" in (await get())["ap-clear"]);
}

// ============ register / referral / verify
{
  const { env, DB } = world();
  seedUser(DB, "inviter", { code: "ABCD2345" }); seedUser(DB, "unv", { code: "UNVER222", verified: 0 }); seedUser(DB, "susp", { code: "SUSP2222", status: "suspended" });
  const reg = (email, extra = {}, ip = "203.0.113.9") =>
    register(ctx(env, { body: { fullName: "New Student", email, password: "Password123", department: "Computer Science", level: "100", ...extra }, headers: { "CF-Connecting-IP": ip } }));
  const uid = (email) => one(DB, "SELECT id FROM users WHERE email=?", email).id;

  let r = await reg("a@x.com", { referralCode: "abcd2345" });
  check("register: still 201 with a referral code", r.status === 201 && r.body.success);
  const a = one(DB, "SELECT referred_by, signup_ip_hash h FROM users WHERE email='a@x.com'");
  check("register: valid code (any case) links the inviter and records a 'signed_up' referral", a.referred_by === "inviter" && one(DB, "SELECT status, inviter_id, earned FROM referrals WHERE invitee_id=?", uid("a@x.com")).status === "signed_up");
  check("register: IP stored only as a 32-hex salted hash (never the raw IP)", /^[0-9a-f]{32}$/.test(a.h) && !a.h.includes("203"));
  await reg("b@x.com", {}, "203.0.113.9"); await reg("c@x.com", {}, "198.51.100.4");
  const hh = (e) => one(DB, "SELECT signup_ip_hash h FROM users WHERE email=?", e).h;
  check("register: same IP → same hash; different IP → different hash", hh("a@x.com") === hh("b@x.com") && hh("a@x.com") !== hh("c@x.com"));
  check("register: no code → no referral, no problem", one(DB, "SELECT referred_by r FROM users WHERE email='b@x.com'").r === null && n(DB, "SELECT COUNT(*) AS n FROM referrals WHERE invitee_id=?", uid("b@x.com")) === 0);
  for (const [email, code] of [["d@x.com", "NOPE9999"], ["e@x.com", "UNVER222"], ["f@x.com", "SUSP2222"], ["g@x.com", "bad code!!"], ["h@x.com", ""]]) {
    const rr = await reg(email, { referralCode: code });
    check(`register: code '${code}' (unknown/unverified/suspended/malformed) → signup still succeeds, no referral`, rr.status === 201 && n(DB, "SELECT COUNT(*) AS n FROM referrals WHERE invitee_id=?", uid(email)) === 0);
  }
  await reg("i@x.com", { referralCode: "ABCD2345" });
  check("register: one inviter can bring many friends", n(DB, "SELECT COUNT(*) AS n FROM referrals WHERE inviter_id='inviter'") === 2);
  check("register: duplicate email still rejected as before (409)", (await reg("a@x.com")).status === 409);

  const dup = await captureReferral(DB, { inviteeId: uid("a@x.com"), rawCode: "ABCD2345", ts: iso(0) });
  check("referral: a second capture for the same invitee is swallowed, not thrown (UNIQUE invitee)", dup === null && n(DB, "SELECT COUNT(*) AS n FROM referrals WHERE invitee_id=?", uid("a@x.com")) === 1);

  // email verification moves signed_up → verified, and never downgrades
  const id = uid("a@x.com");
  DB._raw.prepare("UPDATE users SET verification_otp=?, verification_otp_expires=? WHERE id=?").run(await hashOtp(env, id, "verify", "123456"), new Date(Date.now() + 600000).toISOString(), id);
  const v = await verifyOTP(ctx(env, { body: { email: "a@x.com", otp: "123456" } }));
  check("verifyOTP: still succeeds and returns a token", v.status === 200 && v.body.success && !!v.body.token);
  check("verifyOTP: referral 'signed_up' → 'verified'", one(DB, "SELECT status FROM referrals WHERE invitee_id=?", id).status === "verified");
  DB._raw.prepare("UPDATE referrals SET status='contributed' WHERE invitee_id=?").run(id);
  await markReferralVerified(DB, id, iso(0));
  check("referral: 'contributed' is never downgraded by a late verify", one(DB, "SELECT status FROM referrals WHERE invitee_id=?", id).status === "contributed");
  const id2 = uid("b@x.com");
  DB._raw.prepare("UPDATE users SET verification_otp=?, verification_otp_expires=? WHERE id=?").run(await hashOtp(env, id2, "verify", "654321"), new Date(Date.now() + 600000).toISOString(), id2);
  check("verifyOTP: a user with no referral verifies exactly as before", (await verifyOTP(ctx(env, { body: { email: "b@x.com", otp: "654321" } }))).status === 200);
}

// ============ deletion cascades
{
  const build = () => {
    const w = world();
    const { DB } = w;
    ["V", "W", "X", "Y"].forEach((id) => seedUser(DB, id, { name: id + " Person" }));
    DB._raw.prepare("UPDATE users SET referred_by='V' WHERE id='X'").run();
    DB._raw.prepare("UPDATE users SET referred_by='Y' WHERE id='V'").run();
    seedBounty(DB, { id: "B1" });
    seedResource(DB, { id: "vr1", uploader: "V", status: "approved", bountyId: "B1" });
    seedResource(DB, { id: "wr1", uploader: "W", status: "approved" });
    seedLedger(DB, { id: "LV1", user: "V", amount: 100, resource: "vr1", tier: "standard" });
    seedLedger(DB, { id: "LV2", user: "V", amount: 40, resource: null, tier: "referral" });
    seedLedger(DB, { id: "LW1", user: "W", amount: 50, resource: "vr1", tier: "referral" });   // W earned something tied to V's resource
    seedLedger(DB, { id: "LW2", user: "W", amount: 100, resource: "wr1", tier: "standard" });
    DB._raw.prepare("INSERT INTO referrals (id,inviter_id,invitee_id,status,created_at,updated_at) VALUES ('rf1','V','X','verified',?,?),('rf2','Y','V','verified',?,?)").run(...Array(4).fill(iso(1)));
    DB._raw.prepare("INSERT INTO incentive_flags (id,user_id,status,created_at,updated_at) VALUES ('fv','V','open',?,?),('fw','W','open',?,?)").run(...Array(4).fill(iso(1)));
    return w;
  };

  let { env, DB } = build();
  let fkError = null;
  try { DB._raw.exec("BEGIN"); DB._raw.prepare("DELETE FROM users WHERE id='V'").run(); } catch (e) { fkError = e.message; } finally { try { DB._raw.exec("ROLLBACK"); } catch {} }
  check("setup is meaningful: a bare DELETE of the user violates a foreign key (so the cascade is needed)", /FOREIGN KEY/i.test(fkError || ""), String(fkError));

  const r = await deleteMyAccount(ctx(env, { user: { id: "V" } }));
  check("deleteMyAccount: succeeds with rewards, referrals and flags present", r.status === 200 && r.body.success, JSON.stringify(r.body));
  check("deleteMyAccount: the user is gone", n(DB, "SELECT COUNT(*) AS n FROM users WHERE id='V'") === 0);
  const lv1 = one(DB, "SELECT user_id u, resource_id r, amount a FROM reward_ledger WHERE id='LV1'"), lv2 = one(DB, "SELECT user_id u FROM reward_ledger WHERE id='LV2'");
  check("deleteMyAccount: their reward history is KEPT but detached (user_id/resource_id NULL)", lv1 && lv1.u === null && lv1.r === null && lv1.a === 100 && lv2 && lv2.u === null);
  const lw1 = one(DB, "SELECT user_id u, resource_id r FROM reward_ledger WHERE id='LW1'");
  check("deleteMyAccount: another student's reward tied to the deleted resource is kept, resource detached", lw1.u === "W" && lw1.r === null);
  check("deleteMyAccount: referrals involving them removed; invitee's referred_by cleared; their flags removed (others' kept)", n(DB, "SELECT COUNT(*) AS n FROM referrals") === 0 && one(DB, "SELECT referred_by r FROM users WHERE id='X'").r === null && n(DB, "SELECT COUNT(*) AS n FROM incentive_flags WHERE user_id='V'") === 0 && n(DB, "SELECT COUNT(*) AS n FROM incentive_flags WHERE user_id='W'") === 1);
  check("deleteMyAccount: unrelated users/ledger rows untouched", one(DB, "SELECT user_id u, resource_id r FROM reward_ledger WHERE id='LW2'").r === "wr1" && n(DB, "SELECT COUNT(*) AS n FROM users WHERE id IN ('W','X','Y')") === 3);

  // permanent resource deletion
  const pr = await permanentlyDeleteResource(ctx(env, { user: admin, params: { id: "wr1" } }));
  check("permanentlyDeleteResource: succeeds when a reward references the resource", pr.status === 200 && n(DB, "SELECT COUNT(*) AS n FROM resources WHERE id='wr1'") === 0, JSON.stringify(pr.body));
  const lw2 = one(DB, "SELECT user_id u, resource_id r, amount a FROM reward_ledger WHERE id='LW2'");
  check("permanentlyDeleteResource: the reward row is kept, detached from the resource", lw2.u === "W" && lw2.r === null && lw2.a === 100);
}

summary();
